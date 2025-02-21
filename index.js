const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);

const connectDB = require('./configs/database');
const router = require('./routers');

// --- Các model cho chat ---
const Message = require('./models/message.model');
const Reaction = require('./models/reaction.model');

// --- Các model cho friend functionality ---
const accountModel = require('./models/account.model');
const FriendRequest = require('./models/friendRequest.model');
const GroupChat = require('./models/groupChat.model');

app.use(express.json());
app.use(express.static("public"));
app.set('view engine', 'ejs');
app.set("views", 'views');

// Object lưu các socket của user (key là username)
const users = {};

io.on('connection', (client) => {
    console.log('a user connected');

    // Đăng ký username khi client kết nối
    client.on("registerUser", (username) => {
        users[username] = client;
        client.username = username;
    });

    client.on("disconnect", () => {
        if (client.username) {
            delete users[client.username];
        }
    });

    // ---------------------------
    // PHẦN CHAT (các sự kiện join, leave, message, deleteMessage, emotion …)
    // ---------------------------
    client.on('join', async (data) => {
        const currentRoom = data;
        client.join(currentRoom);
        try {
            const history = await Message.find({ room: currentRoom }).sort({ createdAt: 1 });
            client.emit("history", JSON.stringify(history));
            const reactions = await Reaction.find({ room: currentRoom }).sort({ createdAt: 1 });
            client.emit("reactionHistory", JSON.stringify(reactions));
        } catch (err) {
            console.error("Error retrieving chat history:", err);
        }
    });

    client.on("leave", (data) => {
        client.leave(data);
    });

    client.on("message", async (data) => {
        let messageObj;
        try {
            messageObj = JSON.parse(data);
        } catch (err) {
            console.error("Error parsing message data:", err);
            return;
        }
        const currentRoom = messageObj.room;
        try {
            const newMessage = await Message.create({
                name: messageObj.name,
                message: messageObj.message,
                room: currentRoom
            });
            messageObj._id = newMessage._id;
            io.to(currentRoom).emit("thread", JSON.stringify(messageObj));

            // Phát thông báo đến các thành viên trong phòng
            if (currentRoom.indexOf('_') > -1) {
                try {
                    const group = await GroupChat.findOne({ roomId: currentRoom });
                    if (group) {
                        group.members.forEach(member => {
                            if (member !== client.username && users[member]) {
                                users[member].emit("notification", { room: currentRoom, message: JSON.stringify(messageObj) });
                            }
                        });
                    }
                } catch (err) {
                    console.error("Error retrieving group info:", err);
                }
            } else {
                const participants = currentRoom.split('-');
                participants.forEach(user => {
                    if (user !== client.username && users[user]) {
                        users[user].emit("notification", { room: currentRoom, message: JSON.stringify(messageObj) });
                    }
                });
            }
        } catch (err) {
            console.error("Error saving message:", err);
        }
    });

    client.on("deleteMessage", async (data) => {
        try {
            const msg = await Message.findById(data.messageId);
            if (!msg) {
                client.emit("deleteMessageResult", { success: false, message: "Tin nhắn không tồn tại." });
                return;
            }
            if (msg.name !== client.username) {
                client.emit("deleteMessageResult", { success: false, message: "Bạn chỉ được xóa tin nhắn của chính mình." });
                return;
            }
            await Message.deleteOne({ _id: data.messageId });
            io.to(data.room).emit("messageDeleted", JSON.stringify({ messageId: data.messageId, room: data.room }));
            client.emit("deleteMessageResult", { success: true, message: "Đã xóa tin nhắn thành công." });
        } catch (err) {
            console.error("Error deleting message:", err);
            client.emit("deleteMessageResult", { success: false, message: "Lỗi server." });
        }
    });

    client.on("emotion", async (data) => {
        let reactionObj;
        try {
            reactionObj = JSON.parse(data);
        } catch (err) {
            console.error("Error parsing emotion data:", err);
            return;
        }
        try {
            await Reaction.create({
                messageId: reactionObj.messageId,
                room: reactionObj.room,
                user: reactionObj.user,
                emotion: reactionObj.emotion
            });
            console.log("Saved reaction:", reactionObj);
        } catch (err) {
            console.error("Error saving reaction:", err);
        }
        io.to(reactionObj.room).emit("emotion", data);
    });

    // ---------------------------
    // PHẦN FRIEND FUNCTIONALITY (addFriend, cancelFriend, respondFriendRequest, getFriendRequests, getFriends)
    // ---------------------------
    // [Các sự kiện friend của bạn giữ nguyên…]

    // ---------------------------
    // PHẦN GROUP CHAT
    // ---------------------------
    client.on("createGroupChat", (data) => {
        // data: { groupName, members }
        const creator = client.username;
        if (!data.members.includes(creator)) {
            data.members.push(creator);
        }
        const roomId = data.groupName + "_" + Date.now();
        client.join(roomId);
        GroupChat.create({
            groupName: data.groupName,
            roomId: roomId,
            owner: creator,
            deputies: [],
            members: data.members
        })
            .then(() => {
                data.members.forEach((member) => {
                    if (users[member]) {
                        users[member].emit("newGroupChat", JSON.stringify({
                            groupName: data.groupName,
                            roomId: roomId,
                            members: data.members,
                            owner: creator,
                            deputies: []
                        }));
                    }
                });
            })
            .catch(err => {
                console.error("Error creating group chat:", err);
            });
    });

    client.on("getUserConversations", async (username) => {
        try {
            const groups = await GroupChat.find({ members: username });
            const groupChats = [];
            for (const group of groups) {
                const messages = await Message.find({ room: group.roomId }).sort({ createdAt: 1 });
                groupChats.push({
                    roomId: group.roomId,
                    groupName: group.groupName,
                    members: group.members,
                    owner: group.owner,
                    deputies: group.deputies,
                    messages: messages
                });
            }
            // [Lấy private chats...]
            const account = await accountModel.findOne({ username });
            const privateChats = [];
            if (account && account.friends && account.friends.length > 0) {
                for (const friend of account.friends) {
                    const room = [username, friend].sort().join('-');
                    const messages = await Message.find({ room: room }).sort({ createdAt: 1 });
                    privateChats.push({
                        roomId: room,
                        friend: friend,
                        messages: messages
                    });
                }
            }
            client.emit("userConversations", JSON.stringify({ groupChats, privateChats }));
        } catch (err) {
            console.error("Error loading user conversations:", err);
            client.emit("userConversations", JSON.stringify({ groupChats: [], privateChats: [] }));
        }
    });

    // ---------------------------
    // PHẦN GROUP MANAGEMENT FUNCTIONALITY
    // ---------------------------
    client.on("getGroupDetails", async (data) => {
        // data: { roomId }
        try {
            const group = await GroupChat.findOne({ roomId: data.roomId });
            if (!group) {
                client.emit("groupDetailsResult", { success: false, message: "Group not found." });
                return;
            }
            client.emit("groupDetailsResult", { success: true, group });
        } catch (err) {
            client.emit("groupDetailsResult", { success: false, message: "Error retrieving group details." });
        }
    });

    // client.on("addGroupMember", async (data) => {
    //     // data: { roomId, newMember }
    //     try {
    //         const group = await GroupChat.findOne({ roomId: data.roomId });
    //         if (!group) {
    //             client.emit("groupManagementResult", { success: false, message: "Group not found" });
    //             return;
    //         }
    //         if (group.owner !== client.username && !group.deputies.includes(client.username)) {
    //             client.emit("groupManagementResult", { success: false, message: "Not authorized" });
    //             return;
    //         }
    //         if (group.members.includes(data.newMember)) {
    //             client.emit("groupManagementResult", { success: false, message: "Member already in group" });
    //             return;
    //         }
    //         group.members.push(data.newMember);
    //         await group.save();
    //         io.to(data.roomId).emit("groupUpdated", JSON.stringify({ action: "addMember", newMember: data.newMember, group }));
    //         client.emit("groupManagementResult", { success: true, message: "Member added" });
    //     } catch (err) {
    //         client.emit("groupManagementResult", { success: false, message: "Error adding member" });
    //     }
    // });
    client.on("addGroupMember", async (data) => {
        // data: { roomId, newMember }
        try {
            const group = await GroupChat.findOne({ roomId: data.roomId });
            if (!group) {
                client.emit("groupManagementResult", { success: false, message: "Group not found" });
                return;
            }
            // Cho phép bất kỳ thành viên nào (member, owner, deputy) đều có thể thêm thành viên
            if (group.members.includes(data.newMember)) {
                client.emit("groupManagementResult", { success: false, message: "Member already in group" });
                return;
            }
            group.members.push(data.newMember);
            await group.save();

            // Gửi event cập nhật nhóm cho tất cả thành viên đang có trong room (những người đã join)
            io.to(data.roomId).emit("groupUpdated", JSON.stringify({ action: "addMember", newMember: data.newMember, group }));
            client.emit("groupManagementResult", { success: true, message: "Member added" });

            // Nếu người được thêm đang online, gửi thông báo riêng
            if (users[data.newMember]) {
                users[data.newMember].emit("addedToGroup", {
                    roomId: data.roomId,
                    group,
                    message: `Bạn đã được thêm vào nhóm "${group.groupName}".`
                });
            }
        } catch (err) {
            client.emit("groupManagementResult", { success: false, message: "Error adding member" });
        }
    });


    // client.on("removeGroupMember", async (data) => {
    //     // data: { roomId, memberToRemove }
    //     try {
    //         const group = await GroupChat.findOne({ roomId: data.roomId });
    //         if (!group) {
    //             client.emit("groupManagementResult", { success: false, message: "Group not found" });
    //             return;
    //         }
    //         if (group.owner !== client.username && !group.deputies.includes(client.username)) {
    //             client.emit("groupManagementResult", { success: false, message: "Not authorized" });
    //             return;
    //         }
    //         if (group.owner === data.memberToRemove) {
    //             client.emit("groupManagementResult", { success: false, message: "Cannot remove group owner" });
    //             return;
    //         }
    //         if (!group.members.includes(data.memberToRemove)) {
    //             client.emit("groupManagementResult", { success: false, message: "Member not in group" });
    //             return;
    //         }
    //         group.members = group.members.filter(m => m !== data.memberToRemove);
    //         group.deputies = group.deputies.filter(m => m !== data.memberToRemove);
    //         await group.save();
    //         io.to(data.roomId).emit("groupUpdated", JSON.stringify({ action: "removeMember", removedMember: data.memberToRemove, group }));
    //         client.emit("groupManagementResult", { success: true, message: "Member removed" });
    //     } catch (err) {
    //         client.emit("groupManagementResult", { success: false, message: "Error removing member" });
    //     }
    // });
    client.on("removeGroupMember", async (data) => {
        // data: { roomId, memberToRemove }
        try {
            const group = await GroupChat.findOne({ roomId: data.roomId });
            if (!group) {
                client.emit("groupManagementResult", { success: false, message: "Group not found" });
                return;
            }
            // Chỉ cho phép owner hoặc deputy xóa thành viên
            if (group.owner !== client.username && !group.deputies.includes(client.username)) {
                client.emit("groupManagementResult", { success: false, message: "Not authorized" });
                return;
            }
            if (group.owner === data.memberToRemove) {
                client.emit("groupManagementResult", { success: false, message: "Cannot remove group owner" });
                return;
            }
            if (!group.members.includes(data.memberToRemove)) {
                client.emit("groupManagementResult", { success: false, message: "Member not in group" });
                return;
            }
            // Loại bỏ thành viên khỏi danh sách
            group.members = group.members.filter(m => m !== data.memberToRemove);
            group.deputies = group.deputies.filter(m => m !== data.memberToRemove);
            await group.save();

            // Phát thông báo cập nhật nhóm cho tất cả thành viên trong phòng
            io.to(data.roomId).emit("groupUpdated", JSON.stringify({ action: "removeMember", removedMember: data.memberToRemove, group }));
            client.emit("groupManagementResult", { success: true, message: "Member removed" });

            // Nếu thành viên bị kick đang online, gửi thông báo riêng
            if (users[data.memberToRemove]) {
                users[data.memberToRemove].emit("kickedFromGroup", {
                    roomId: data.roomId,
                    message: `Bạn đã bị kick ra khỏi nhóm ${group.groupName}`
                });
            }
        } catch (err) {
            console.error("Error in removeGroupMember:", err);
            client.emit("groupManagementResult", { success: false, message: "Error removing member" });
        }
    });


    client.on("transferGroupOwner", async (data) => {
        // data: { roomId, newOwner }
        try {
            const group = await GroupChat.findOne({ roomId: data.roomId });
            if (!group) {
                client.emit("groupManagementResult", { success: false, message: "Group not found" });
                return;
            }
            if (group.owner !== client.username) {
                client.emit("groupManagementResult", { success: false, message: "Only group owner can transfer ownership" });
                return;
            }
            if (!group.members.includes(data.newOwner)) {
                client.emit("groupManagementResult", { success: false, message: "New owner must be a member" });
                return;
            }
            group.owner = data.newOwner;
            group.deputies = group.deputies.filter(m => m !== data.newOwner);
            await group.save();
            io.to(data.roomId).emit("groupUpdated", JSON.stringify({ action: "transferOwner", newOwner: data.newOwner, group }));
            client.emit("groupManagementResult", { success: true, message: "Ownership transferred" });
        } catch (err) {
            client.emit("groupManagementResult", { success: false, message: "Error transferring ownership" });
        }
    });

    client.on("assignDeputy", async (data) => {
        // data: { roomId, member }
        try {
            const group = await GroupChat.findOne({ roomId: data.roomId });
            if (!group) {
                client.emit("groupManagementResult", { success: false, message: "Group not found" });
                return;
            }
            if (group.owner !== client.username) {
                client.emit("groupManagementResult", { success: false, message: "Only group owner can assign deputy" });
                return;
            }
            if (!group.members.includes(data.member)) {
                client.emit("groupManagementResult", { success: false, message: "Member not in group" });
                return;
            }
            if (group.deputies.includes(data.member)) {
                client.emit("groupManagementResult", { success: false, message: "Member is already deputy" });
                return;
            }
            group.deputies.push(data.member);
            await group.save();
            io.to(data.roomId).emit("groupUpdated", JSON.stringify({ action: "assignDeputy", deputy: data.member, group }));
            client.emit("groupManagementResult", { success: true, message: "Deputy assigned" });
        } catch (err) {
            client.emit("groupManagementResult", { success: false, message: "Error assigning deputy" });
        }
    });

    client.on("cancelDeputy", async (data) => {
        // data: { roomId, member }
        try {
            const group = await GroupChat.findOne({ roomId: data.roomId });
            if (!group) {
                client.emit("groupManagementResult", { success: false, message: "Group not found" });
                return;
            }
            if (group.owner !== client.username) {
                client.emit("groupManagementResult", { success: false, message: "Only group owner can cancel deputy" });
                return;
            }
            if (!group.deputies.includes(data.member)) {
                client.emit("groupManagementResult", { success: false, message: "Member is not deputy" });
                return;
            }
            group.deputies = group.deputies.filter(m => m !== data.member);
            await group.save();
            io.to(data.roomId).emit("groupUpdated", JSON.stringify({ action: "cancelDeputy", member: data.member, group }));
            client.emit("groupManagementResult", { success: true, message: "Deputy role canceled" });
        } catch (err) {
            client.emit("groupManagementResult", { success: false, message: "Error canceling deputy" });
        }
    });


    // Leave Group: Thành viên tự rời khỏi nhóm
    client.on("leaveGroup", async (data) => {
        // data: { roomId }
        try {
            const group = await GroupChat.findOne({ roomId: data.roomId });
            if (!group) {
                client.emit("groupManagementResult", { success: false, message: "Group not found" });
                return;
            }
            // Nếu user là owner thì không cho phép tự out
            if (group.owner === client.username) {
                client.emit("groupManagementResult", { success: false, message: "Owner cannot leave the group. Please disband or transfer ownership." });
                return;
            }
            // Loại bỏ user khỏi danh sách thành viên và deputies (nếu có)
            group.members = group.members.filter(m => m !== client.username);
            group.deputies = group.deputies.filter(m => m !== client.username);
            await group.save();

            // Thông báo cập nhật cho tất cả thành viên đang online (dù có join room hay không)
            group.members.forEach(member => {
                if (users[member]) {
                    users[member].emit("groupUpdated", JSON.stringify({ action: "leaveGroup", leftMember: client.username, group }));
                }
            });
            // Broadcast tới room (cho những client đã join room)
            io.to(data.roomId).emit("groupUpdated", JSON.stringify({ action: "leaveGroup", leftMember: client.username, group }));

            // Gửi event riêng cho thành viên rời nhóm để xử lý giao diện (ví dụ: xóa chat)
            client.emit("leftGroup", { roomId: data.roomId, message: `Bạn đã rời khỏi nhóm "${group.groupName}"` });
        } catch (err) {
            console.error("Error in leaveGroup:", err);
            client.emit("groupManagementResult", { success: false, message: "Error leaving group" });
        }
    });

    // Disband Group: Owner giải tán nhóm
    client.on("disbandGroup", async (data) => {
        // data: { roomId }
        try {
            const group = await GroupChat.findOne({ roomId: data.roomId });
            if (!group) {
                client.emit("groupManagementResult", { success: false, message: "Group not found" });
                return;
            }
            if (group.owner !== client.username) {
                client.emit("groupManagementResult", { success: false, message: "Only group owner can disband the group" });
                return;
            }
            const disbandMessage = `Nhóm "${group.groupName}" đã bị giải tán`;

            // Thông báo realtime đến tất cả các thành viên trong danh sách group.members
            group.members.forEach(member => {
                if (users[member]) {
                    users[member].emit("groupDisbanded", { roomId: data.roomId, message: disbandMessage });
                }
            });
            // Broadcast tới room để đảm bảo những client đã join cũng nhận được thông báo
            io.to(data.roomId).emit("groupDisbanded", { roomId: data.roomId, message: disbandMessage });

            // Xóa group khỏi cơ sở dữ liệu
            await GroupChat.deleteOne({ roomId: data.roomId });
            client.emit("groupManagementResult", { success: true, message: "Group disbanded" });
        } catch (err) {
            console.error("Error in disbandGroup:", err);
            client.emit("groupManagementResult", { success: false, message: "Error disbanding group" });
        }
    });


});

connectDB();
router(app);

server.listen(5000, () => {
    console.log('Server is running on port 5000');
});
