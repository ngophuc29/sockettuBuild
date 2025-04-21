const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');

const cors = require("cors");
app.use(cors({ origin: "*" }));

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

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

// Object lưu socket của user (key: username)
const users = {};
// Map lưu trạng thái đang call của từng user
const usersInCall = {};

io.on('connection', (client) => {
    console.log('A user connected');

    // Đăng ký username khi client kết nối
    client.on("registerUser", (username) => {
        users[username] = client;
        client.username = username;
        console.log(`[REGISTER] ${username} → ${client.id}`);
        // Phát sự kiện đến tất cả các client khác để thông báo có user mới đăng ký
        client.broadcast.emit("userJoined", { username });
    });

    client.on("disconnect", () => {
        if (client.username) {
            delete users[client.username];
            delete usersInCall[client.username];
        }
    });

    // ---------------------------
    // PHẦN CHAT (join, leave, message, deleteMessage, emotion …)
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
                room: currentRoom,
                fileUrl: messageObj.fileUrl
            });
            messageObj._id = newMessage._id;
            io.to(currentRoom).emit("thread", JSON.stringify(messageObj));

            // Gửi notification cho các thành viên trong phòng.
            // Nếu room là group chat (có dấu '_' trong roomId) thì dựa theo GroupChat model.
            if (currentRoom.indexOf('_') > -1) {
                try {
                    const group = await GroupChat.findOne({ roomId: currentRoom });
                    if (group) {
                        group.members.forEach(member => {
                            if (member !== client.username && users[member]) {
                                // Kiểm tra socket của member có join room này chưa
                                if (!users[member].rooms || !users[member].rooms.has(currentRoom)) {
                                    users[member].emit("notification", { room: currentRoom, message: JSON.stringify(messageObj) });
                                }
                            }
                        });
                    }
                } catch (err) {
                    console.error("Error retrieving group info:", err);
                }
            } else {
                // Private chat: room id được tạo theo [userA, userB].sort().join("-")
                const participants = currentRoom.split('-');
                participants.forEach(user => {
                    if (user !== client.username && users[user]) {
                        if (!users[user].rooms || !users[user].rooms.has(currentRoom)) {
                            users[user].emit("notification", { room: currentRoom, message: JSON.stringify(messageObj) });
                        }
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
    // PHẦN FRIEND FUNCTIONALITY
    // ---------------------------
    // Thêm event handler mới
    client.on('getSentFriendRequests', async (username) => {
        try {
            const requests = await FriendRequest.find({ from: username, status: 'pending' });
            client.emit('sentFriendRequests', requests);
        } catch (err) {
            console.error("Error fetching sent friend requests:", err);
        }
    });
    client.on('addFriend', async (data) => {
        try {
            const { myUsername, friendUsername } = data;
            const user = await accountModel.findOne({ username: myUsername });
            if (!user) {
                client.emit('addFriendResult', { success: false, message: "User không tồn tại" });
                return;
            }
            if (user.friends.includes(friendUsername)) {
                client.emit('addFriendResult', { success: false, message: "Hai người đã là bạn bè" });
                return;
            }
            const existing = await FriendRequest.findOne({ from: myUsername, to: friendUsername });
            if (existing) {
                client.emit('addFriendResult', { success: false, message: "Lời mời đã được gửi trước đó" });
                return;
            }
            // Sửa lại ở đây: Thêm status 'pending'
            await FriendRequest.create({ from: myUsername, to: friendUsername, status: 'pending' });
            // Thông báo cho người gửi
            client.emit('addFriendResult', { success: true, message: `Gửi lời mời kết bạn đến ${friendUsername} thành công` });
            // Phát sự kiện realtime: cho bên nhận biết có lời mời mới
            if (users[friendUsername]) {
                // Gửi thông báo có lời mời mới
                users[friendUsername].emit("newFriendRequest", {
                    from: myUsername,
                    // Gửi luôn toàn bộ danh sách lời mời mới
                    requests: await FriendRequest.find({ to: friendUsername, status: 'pending' })
                });
            }
            // Phát sự kiện chung để các client khác cập nhật nếu cần
            io.emit('friendRequestUpdated', {
                to: friendUsername,
                action: 'added'
            });
        } catch (err) {
            console.error("Lỗi kết bạn:", err);
            client.emit('addFriendResult', { success: false, message: "Lỗi server" });
        }
    });

    client.on('cancelFriend', async (data) => {
        try {
            const { myUsername, friendUsername } = data;
            // 1) Cập nhật DB
            await Promise.all([
                accountModel.updateOne({ username: myUsername }, { $pull: { friends: friendUsername } }),
                accountModel.updateOne({ username: friendUsername }, { $pull: { friends: myUsername } })
            ]);

            // 2) Lấy lại danh sách bạn hiện tại
            const userA = await accountModel.findOne({ username: myUsername });
            const userB = await accountModel.findOne({ username: friendUsername });
            const listA = userA.friends;
            const listB = userB.friends;

            // 3) Emit kết quả và cập nhật realtime
            client.emit('cancelFriendResult', { success: true, message: `Hủy kết bạn với ${friendUsername} thành công` });

            if (users[myUsername]) {
                users[myUsername].emit('friendsListUpdated', listA);
            }
            if (users[friendUsername]) {
                users[friendUsername].emit('friendsListUpdated', listB);
            }
        } catch (err) {
            console.error("[cancelFriend] Lỗi khi hủy kết bạn:", err);
            client.emit('cancelFriendResult', { success: false, message: "Lỗi server" });
        }
    });


    // Khi phản hồi lời mời kết bạn, nếu accepted cập nhật danh sách bạn và tạo room theo công thức
    client.on('respondFriendRequest', async (data) => {
        try {
            const { requestId, action } = data;
            const request = await FriendRequest.findById(requestId);
            if (!request) {
                client.emit('respondFriendRequestResult', { success: false, message: "Lời mời không tồn tại" });
                return;
            }
            if (action === 'accepted') {
                // 1) Cập nhật DB
                await accountModel.updateOne(
                    { username: request.from },
                    { $addToSet: { friends: request.to } }
                );
                await accountModel.updateOne(
                    { username: request.to },
                    { $addToSet: { friends: request.from } }
                );

                // 2) Tạo room chat
                const roomId = [request.from, request.to].sort().join("-");

                // 3) Lấy lại danh sách bạn mới
                const userFrom = await accountModel.findOne({ username: request.from });
                const userTo = await accountModel.findOne({ username: request.to });
                const listFrom = userFrom.friends;
                const listTo = userTo.friends;

                // 4) Emit cho cả hai user
                if (users[request.from]) {
                    users[request.from].emit("friendAccepted", { friend: request.to, roomId });
                    users[request.from].emit("friendsListUpdated", listFrom);
                }
                if (users[request.to]) {
                    users[request.to].emit("friendAccepted", { friend: request.from, roomId });
                    users[request.to].emit("friendsListUpdated", listTo);
                }
            }
            // Xoá lời mời đã xử lý
            await FriendRequest.deleteOne({ _id: requestId });
            client.emit('respondFriendRequestResult', { success: true, message: `Lời mời đã được ${action}` });
        } catch (err) {
            console.error(err);
            client.emit('respondFriendRequestResult', { success: false, message: "Lỗi server" });
        }
    });

    // client.on('withdrawFriendRequest', async (data) => {
    //     try {
    //         const { myUsername, friendUsername } = data;
    //         console.log(`[withdrawFriendRequest] ${myUsername} thu hồi lời mời gửi đến ${friendUsername}`);

    //         const deleted = await FriendRequest.findOneAndDelete({ from: myUsername, to: friendUsername });

    //         if (!deleted) {
    //             client.emit('withdrawFriendRequestResult', { success: false, message: "Không tìm thấy lời mời đã gửi để thu hồi." });
    //             return;
    //         }

    //         client.emit('withdrawFriendRequestResult', { success: true, message: `Đã thu hồi lời mời kết bạn gửi đến ${friendUsername}` });

    //         // Nếu người nhận đang online, cập nhật lại danh sách lời mời
    //         if (users[friendUsername]) {
    //             const updatedRequests = await FriendRequest.find({ to: friendUsername, status: 'pending' });
    //             users[friendUsername].emit('friendRequests', updatedRequests);
    //         }

    //     } catch (err) {
    //         console.error("[withdrawFriendRequest] Lỗi thu hồi lời mời:", err);
    //         client.emit('withdrawFriendRequestResult', { success: false, message: "Lỗi server" });
    //     }
    // });
    client.on('withdrawFriendRequest', async (data) => {
        try {
            const { myUsername, friendUsername } = data;
            console.log(`[withdrawFriendRequest] ${myUsername} thu hồi lời mời gửi đến ${friendUsername}`);

            const deleted = await FriendRequest.findOneAndDelete({ from: myUsername, to: friendUsername });

            if (!deleted) {
                client.emit('withdrawFriendRequestResult', {
                    success: false,
                    message: "Không tìm thấy lời mời đã gửi để thu hồi."
                });
                return;
            }
            io.emit('friendRequestWithdrawn', { from: myUsername, to: friendUsername });
            client.emit('withdrawFriendRequestResult', {
                success: true,
                message: `Đã thu hồi lời mời kết bạn gửi đến ${friendUsername}`
            });

            // Nếu người nhận đang online
            if (users[friendUsername]) {
                // Gửi thông báo rằng lời mời đã bị thu hồi
                users[friendUsername].emit("friendRequestWithdrawn", {
                    from: myUsername
                });

                // Gửi lại danh sách lời mời mới
                const updatedRequests = await FriendRequest.find({
                    to: friendUsername,
                    status: 'pending'
                });
                users[friendUsername].emit('friendRequests', updatedRequests);
            }

        } catch (err) {
            console.error("[withdrawFriendRequest] Lỗi thu hồi lời mời:", err);
            client.emit('withdrawFriendRequestResult', {
                success: false,
                message: "Lỗi server"
            });
        }
    });

    client.on('getFriendRequests', async (username) => {
        try {
            const requests = await FriendRequest.find({ to: username, status: 'pending' });
            client.emit('friendRequests', requests);
        } catch (err) {
            console.error("Error fetching friend requests", err);
            client.emit('friendRequests', []);
        }
    });

    client.on('getFriends', async (username) => {
        try {
            const user = await accountModel.findOne({ username });
            if (user) {
                client.emit('friendsList', user.friends);
            } else {
                client.emit('friendsList', []);
            }
        } catch (err) {
            console.error(err);
            client.emit('friendsList', []);
        }
    });

    // ---------------------------
    // PHẦN GROUP CHAT & MANAGEMENT
    // ---------------------------
    client.on("createGroupChat", (data) => {
        const creator = client.username;
        if (!data.members.includes(creator)) {
            data.members.push(creator);
        }
        // Group chat room id được tạo bằng cách nối groupName và timestamp
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

    // client.on("getUserConversations", async (username) => {
    //     try {
    //         const groups = await GroupChat.find({ members: username });
    //         const groupChats = [];
    //         for (const group of groups) {
    //             const messages = await Message.find({ room: group.roomId }).sort({ createdAt: 1 });
    //             groupChats.push({
    //                 roomId: group.roomId,
    //                 groupName: group.groupName,
    //                 members: group.members,
    //                 owner: group.owner,
    //                 deputies: group.deputies,
    //                 messages: messages
    //             });
    //         }
    //         // Đối với private chat, dựa vào danh sách bạn được lưu trong tài khoản
    //         const account = await accountModel.findOne({ username });
    //         const privateChats = [];
    //         if (account && account.friends && account.friends.length > 0) {
    //             for (const friend of account.friends) {
    //                 // Room id luôn được tính bằng [username, friend].sort().join("-")
    //                 const room = [username, friend].sort().join('-');
    //                 const messages = await Message.find({ room: room }).sort({ createdAt: 1 });
    //                 privateChats.push({
    //                     roomId: room,
    //                     friend: friend,
    //                     messages: messages
    //                 });
    //             }
    //         }
    //         client.emit("userConversations", JSON.stringify({ groupChats, privateChats }));
    //     } catch (err) {
    //         console.error("Error loading user conversations:", err);
    //         client.emit("userConversations", JSON.stringify({ groupChats: [], privateChats: [] }));
    //     }
    // });
    client.on("getUserConversations", async (username) => {
        try {
            // --- Lấy danh sách group chat như cũ ---
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

            // --- Lấy danh sách private chat theo lịch sử tin nhắn ---
            // Giả sử room private có định dạng: "userA-userB" (không chứa dấu "_")
            const roomIds = await Message.distinct("room", { room: { $not: /_/ } });
            const privateChats = [];
            for (const room of roomIds) {
                // Kiểm tra nếu room có chứa username của người dùng
                if (room.split("-").includes(username)) {
                    const messages = await Message.find({ room: room }).sort({ createdAt: 1 });
                    // Xác định đối phương: với room dạng [userA, userB] => đối phương là người khác với username
                    const participants = room.split("-");
                    const friend = participants.find(name => name !== username) || username;
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

    client.on("addGroupMember", async (data) => {
        try {
            const group = await GroupChat.findOne({ roomId: data.roomId });
            if (!group) {
                client.emit("groupManagementResult", { success: false, message: "Group not found" });
                return;
            }
            if (group.members.includes(data.newMember)) {
                client.emit("groupManagementResult", { success: false, message: "Member already in group" });
                return;
            }
            group.members.push(data.newMember);
            await group.save();
            io.to(data.roomId).emit("groupUpdated", JSON.stringify({ action: "addMember", newMember: data.newMember, group }));
            client.emit("groupManagementResult", { success: true, message: "Member added" });
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

    client.on("removeGroupMember", async (data) => {
        try {
            const group = await GroupChat.findOne({ roomId: data.roomId });
            if (!group) {
                client.emit("groupManagementResult", { success: false, message: "Group not found" });
                return;
            }
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
            group.members = group.members.filter(m => m !== data.memberToRemove);
            group.deputies = group.deputies.filter(m => m !== data.memberToRemove);
            await group.save();
            io.to(data.roomId).emit("groupUpdated", JSON.stringify({ action: "removeMember", removedMember: data.memberToRemove, group }));
            client.emit("groupManagementResult", { success: true, message: "Member removed" });
            if (users[data.memberToRemove]) {
                users[data.memberToRemove].leave(data.roomId);
                users[data.memberToRemove].emit("kickedFromGroup", {
                    roomId: data.roomId,
                    message: `Bạn đã bị loại khỏi nhóm "${group.groupName}"`
                });
            }
        } catch (err) {
            console.error("Error in removeGroupMember:", err);
            client.emit("groupManagementResult", { success: false, message: "Error removing member" });
        }
    });

    client.on("transferGroupOwner", async (data) => {
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

    client.on("leaveGroup", async (data) => {
        try {
            const { roomId, newOwner } = data;
            const group = await GroupChat.findOne({ roomId });
            if (!group) {
                return client.emit("groupManagementResult", { success: false, message: "Group not found." });
            }

            // Nếu là owner
            if (group.owner === client.username) {
                // Bắt buộc phải cung cấp newOwner
                if (!newOwner) {
                    return client.emit("groupManagementResult", {
                        success: false,
                        message: "Bạn là chủ nhóm, phải chuyển quyền cho thành viên khác trước khi rời. Vui lòng truyền { roomId, newOwner }."
                    });
                }
                // Kiểm tra newOwner có trong nhóm không
                if (!group.members.includes(newOwner)) {
                    return client.emit("groupManagementResult", {
                        success: false,
                        message: `Không tìm thấy thành viên '${newOwner}' trong nhóm.`
                    });
                }
                // Chuyển quyền
                group.owner = newOwner;
                // Nếu newOwner trước đó là deputy, giữ nguyên; còn không, có thể thêm vào deputies hoặc để như cũ
                group.deputies = group.deputies.filter(m => m !== newOwner);
            }

            // Loại bỏ member (thường là chính client.username)
            group.members = group.members.filter(m => m !== client.username);
            group.deputies = group.deputies.filter(m => m !== client.username);

            await group.save();

            // Cho tất cả member còn lại biết
            io.to(roomId).emit("groupUpdated", JSON.stringify({
                action: "leaveGroup",
                leftMember: client.username,
                group
            }));

            // Cho client biết đã rời
            client.leave(roomId);
            client.emit("leftGroup", {
                roomId,
                message: `Bạn đã rời khỏi nhóm "${group.groupName}".`
            });
        } catch (err) {
            console.error("Error in leaveGroup:", err);
            client.emit("groupManagementResult", { success: false, message: "Error leaving group." });
        }
    });


    client.on("disbandGroup", async (data) => {
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
            group.members.forEach(member => {
                if (users[member]) {
                    users[member].emit("groupDisbanded", { roomId: data.roomId, message: disbandMessage });
                }
            });
            io.to(data.roomId).emit("groupDisbanded", { roomId: data.roomId, message: disbandMessage });
            await GroupChat.deleteOne({ roomId: data.roomId });
            client.emit("groupManagementResult", { success: true, message: "Group disbanded" });
        } catch (err) {
            console.error("Error in disbandGroup:", err);
            client.emit("groupManagementResult", { success: false, message: "Error disbanding group" });
        }
    });

    // ---------------------------
    // CALL SIGNALING
    // ---------------------------
    client.on("callUser", ({ userToCall, signalData, from }) => {
        const callee = users[userToCall];
        if (!callee) {
            client.emit("callError", { message: "Người nhận không online." });
            return;
        }
        if (usersInCall[userToCall]) {
            client.emit("callError", { message: "Người nhận đang bận." });
            return;
        }
        usersInCall[from] = true;
        usersInCall[userToCall] = true;
        callee.emit("callIncoming", { from, signal: signalData });
    });

    client.on("acceptCall", ({ to, signal }) => {
        const caller = users[to];
        if (caller) {
            caller.emit("callAccepted", { signal });
        }
    });

    client.on("rejectCall", ({ to }) => {
        const caller = users[to];
        if (caller) {
            caller.emit("callRejected");
        }
        delete usersInCall[to];
        delete usersInCall[client.username];
    });

    client.on("iceCandidate", ({ to, candidate }) => {
        const peerSocket = users[to];
        if (peerSocket) {
            peerSocket.emit("iceCandidate", { candidate });
        }
    });

    client.on("endCall", ({ to }) => {
        const peerSocket = users[to];
        if (peerSocket) {
            peerSocket.emit("callEnded");
        }
        delete usersInCall[to];
        delete usersInCall[client.username];
    });
});

connectDB();
router(app);

server.listen(5000, () => {
    console.log('Server is running on port 5000');
});
