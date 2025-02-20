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

// Object lưu các socket của user (key là username)  -> dùng để gửi thông báo riêng cho user
const users = {};

io.on('connection', (client) => {
    console.log('a user connected');

    // Khi client đăng ký username
    client.on("registerUser", (username) => {
        users[username] = client;
        client.username = username; // lưu lại trên client để tiện xử lý disconnect
    });
    client.on("disconnect", () => {
        if (client.username) {
            delete users[client.username];
        }
    });

    // ---------------------------
    // PHẦN CHAT (CODE CŨ)
    // ---------------------------
    var room;
    client.on('join', async (data) => {
        room = data;
        client.join(room);
        try {
            const history = await Message.find({ room: data }).sort({ createdAt: 1 });
            client.emit("history", JSON.stringify(history));
            const reactions = await Reaction.find({ room: data }).sort({ createdAt: 1 });
            client.emit("reactionHistory", JSON.stringify(reactions));
        } catch (err) {
            console.error("Error retrieving chat history:", err);
        }
    });

    client.on("leave", (data) => {
        client.leave(data);
    });

    // client.on("message", async (data) => {
    //     let messageObj;
    //     try {
    //         messageObj = JSON.parse(data);
    //     } catch (err) {
    //         console.error("Error parsing message data:", err);
    //         return;
    //     }
    //     try {
    //         const newMessage = await Message.create({
    //             name: messageObj.name,
    //             message: messageObj.message,
    //             room: messageObj.room
    //         });
    //         messageObj._id = newMessage._id; // Gán _id của MongoDB cho messageObj
    //         io.to(room).emit("thread", JSON.stringify(messageObj));
    //         client.broadcast.emit("notification", { room: room, message: JSON.stringify(messageObj) });
    //     } catch (err) {
    //         console.error("Error saving message:", err);
    //     }
    // });
    client.on("message", async (data) => {
        let messageObj;
        try {
            messageObj = JSON.parse(data);
        } catch (err) {
            console.error("Error parsing message data:", err);
            return;
        }
        try {
            const newMessage = await Message.create({
                name: messageObj.name,
                message: messageObj.message,
                room: messageObj.room
            });
            messageObj._id = newMessage._id; // Gán _id của MongoDB cho messageObj

            // Gửi tin nhắn đến tất cả client đang join room
            io.to(room).emit("thread", JSON.stringify(messageObj));

            // Phân biệt xử lý thông báo:
            if (room.indexOf('_') > -1) {
                // Đây là group chat -> chỉ gửi tới các client trong room (ngoại trừ sender)
                client.broadcast.to(room).emit("notification", { room: room, message: JSON.stringify(messageObj) });
            } else {
                // Đây là private chat (room có dạng "phuc-kk")
                // Lấy danh sách các thành viên từ room name
                const participants = room.split('-');
                participants.forEach(user => {
                    // Gửi thông báo riêng nếu user không phải là người gửi và có đang online (đã đăng ký socket)
                    if (user !== client.username && users[user]) {
                        users[user].emit("notification", { room: room, message: JSON.stringify(messageObj) });
                    }
                });
            }
        } catch (err) {
            console.error("Error saving message:", err);
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
        io.to(room).emit("emotion", data);
    });

    // ---------------------------
    // PHẦN FRIEND FUNCTIONALITY
    // ---------------------------
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
            await FriendRequest.create({ from: myUsername, to: friendUsername });
            client.emit('addFriendResult', { success: true, message: `Gửi lời mời kết bạn đến ${friendUsername} thành công` });
        } catch (err) {
            console.error("Lỗi kết bạn:", err);
            client.emit('addFriendResult', { success: false, message: "Lỗi server" });
        }
    });

    client.on('cancelFriend', async (data) => {
        try {
            const { myUsername, friendUsername } = data;
            await accountModel.updateOne({ username: myUsername }, { $pull: { friends: friendUsername } });
            await accountModel.updateOne({ username: friendUsername }, { $pull: { friends: myUsername } });
            client.emit('cancelFriendResult', { success: true, message: `Hủy kết bạn với ${friendUsername} thành công` });
        } catch (err) {
            console.error(err);
            client.emit('cancelFriendResult', { success: false, message: "Lỗi server" });
        }
    });

    client.on('respondFriendRequest', async (data) => {
        try {
            const { requestId, action } = data;
            const request = await FriendRequest.findById(requestId);
            if (!request) {
                client.emit('respondFriendRequestResult', { success: false, message: "Lời mời không tồn tại" });
                return;
            }
            if (request.status !== 'pending') {
                client.emit('respondFriendRequestResult', { success: false, message: "Lời mời đã được xử lý" });
                return;
            }
            if (action === 'accepted') {
                // Cập nhật danh sách bạn của cả 2 user
                await accountModel.updateOne({ username: request.from }, { $addToSet: { friends: request.to } });
                await accountModel.updateOne({ username: request.to }, { $addToSet: { friends: request.from } });
            }
            // Xóa luôn lời mời kết bạn sau khi trả lời (dù là accepted hay rejected)
            await FriendRequest.deleteOne({ _id: requestId });
            client.emit('respondFriendRequestResult', { success: true, message: `Lời mời đã được ${action}` });
        } catch (err) {
            console.error(err);
            client.emit('respondFriendRequestResult', { success: false, message: "Lỗi server" });
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
    // PHẦN GROUP CHAT
    // ---------------------------
    // client.on("createGroupChat", (data) => {
    //     // data: { groupName, members } members: array of usernames được chọn
    //     const creator = client.username;
    //     // Đảm bảo creator luôn có trong danh sách thành viên
    //     if (!data.members.includes(creator)) {
    //         data.members.push(creator);
    //     }
    //     // Tạo roomId cho group chat (dùng tên nhóm + timestamp)
    //     const roomId = data.groupName + "_" + Date.now();
    //     // Cho người tạo chat join ngay vào room group
    //     client.join(roomId);
    //     // Gửi thông báo tới tất cả thành viên đã chọn (nếu đang online)
    //     data.members.forEach((member) => {
    //         if (users[member]) {
    //             users[member].emit("newGroupChat", JSON.stringify({
    //                 groupName: data.groupName,
    //                 roomId: roomId,
    //                 members: data.members
    //             }));
    //         }
    //     });
    // });
    client.on("createGroupChat", (data) => {
        // data: { groupName, members } members: array of usernames được chọn
        const creator = client.username;
        // Đảm bảo creator luôn có trong danh sách thành viên
        if (!data.members.includes(creator)) {
            data.members.push(creator);
        }
        // Tạo roomId cho group chat (dùng tên nhóm + timestamp)
        const roomId = data.groupName + "_" + Date.now();
        // Cho người tạo chat join ngay vào room group
        client.join(roomId);

        // Lưu thông tin group chat vào DB
        GroupChat.create({
            groupName: data.groupName,
            roomId: roomId,
            members: data.members
        })
            .then(() => {
                // Sau khi lưu thành công, gửi thông báo tới các thành viên đang online
                data.members.forEach((member) => {
                    if (users[member]) {
                        users[member].emit("newGroupChat", JSON.stringify({
                            groupName: data.groupName,
                            roomId: roomId,
                            members: data.members
                        }));
                    }
                });
            })
            .catch(err => {
                console.error("Error creating group chat:", err);
            });
    });



    
});

connectDB();
router(app);

server.listen(5000, (req, res) => {
    console.log('Server is running on port 5000');
});
