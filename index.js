const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);

const connectDB = require('./configs/database');
const router = require('./routers');

// Import model Message, Reaction, Account
const Message = require('./models/message.model');
const Reaction = require('./models/reaction.model');
const accountModel = require('./models/account.model');

// Import model FriendRequest
const FriendRequest = require('./models/friendRequest.model');

app.use(express.json());
app.use(express.static("public"));
app.set('view engine', 'ejs');
app.set("views", 'views');

io.on('connection', (client) => {
    console.log('a user connected');

    var room;
    client.on('join', async (data) => {
        room = data;
        client.join(room);
        // Khi join, truy vấn lịch sử chat của room từ DB (sắp xếp theo createdAt)
        try {
            const history = await Message.find({ room: data }).sort({ createdAt: 1 });
            client.emit("history", JSON.stringify(history));
            // Truy vấn lịch sử reaction của room
            const reactions = await Reaction.find({ room: data }).sort({ createdAt: 1 });
            client.emit("reactionHistory", JSON.stringify(reactions));
        } catch (err) {
            console.error("Error retrieving chat history:", err);
        }
    });

    client.on("leave", (data) => {
        client.leave(data);
    });

    client.on("message", async (data) => {
        io.to(room).emit("thread", data);
        client.broadcast.emit("notification", { room: room, message: data });

        try {
            let messageObj = JSON.parse(data);
            await Message.create({
                name: messageObj.name,
                message: messageObj.message,
                room: messageObj.room
            });
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
            // Lưu reaction vào DB (bao gồm room)
            await Reaction.create({
                messageId: reactionObj.messageId,
                room: reactionObj.room,
                user: reactionObj.user,
                emotion: reactionObj.emotion
            });
        } catch (err) {
            console.error("Error saving reaction:", err);
        }
        io.to(room).emit("emotion", data);
    });

    // --- Xử lý "Kết bạn" qua socket.io và lưu vào DB ---
    client.on('addFriend', async (data) => {
        try {
            const { myUsername, friendUsername } = data;
            // Kiểm tra user hiện tại có tồn tại không
            const user = await accountModel.findOne({ username: myUsername });
            if (!user) {
                client.emit('addFriendResult', { success: false, message: "User không tồn tại" });
                return;
            }
            // Nếu đã là bạn bè thì không cho gửi lời mời nữa
            if (user.friends.includes(friendUsername)) {
                client.emit('addFriendResult', { success: false, message: "Hai người đã là bạn bè" });
                return;
            }
            // Kiểm tra xem lời mời đã tồn tại chưa
            const existing = await FriendRequest.findOne({ from: myUsername, to: friendUsername });
            if (existing) {
                client.emit('addFriendResult', { success: false, message: "Lời mời đã được gửi trước đó" });
                return;
            }
            // Tạo lời mời kết bạn mới
            await FriendRequest.create({ from: myUsername, to: friendUsername });
            client.emit('addFriendResult', { success: true, message: `Gửi lời mời kết bạn đến ${friendUsername} thành công` });
        } catch (err) {
            console.error("Lỗi kết bạn:", err);
            client.emit('addFriendResult', { success: false, message: "Lỗi server" });
        }
    });

    // Xử lý hủy kết bạn
    client.on('cancelFriend', async (data) => {
        try {
            const { myUsername, friendUsername } = data;
            // Loại bỏ friendUsername khỏi danh sách bạn của myUsername và ngược lại
            await accountModel.updateOne({ username: myUsername }, { $pull: { friends: friendUsername } });
            await accountModel.updateOne({ username: friendUsername }, { $pull: { friends: myUsername } });
            client.emit('cancelFriendResult', { success: true, message: `Hủy kết bạn với ${friendUsername} thành công` });
        } catch (err) {
            console.error(err);
            client.emit('cancelFriendResult', { success: false, message: "Lỗi server" });
        }
    });

    // Xử lý trả lời lời mời kết bạn (accepted/rejected)
    client.on('respondFriendRequest', async (data) => {
        try {
            const { requestId, action } = data; // action: 'accepted' hoặc 'rejected'
            const request = await FriendRequest.findById(requestId);
            if (!request) {
                client.emit('respondFriendRequestResult', { success: false, message: "Lời mời không tồn tại" });
                return;
            }
            if (request.status !== 'pending') {
                client.emit('respondFriendRequestResult', { success: false, message: "Lời mời đã được xử lý" });
                return;
            }
            request.status = action;
            await request.save();
            if (action === 'accepted') {
                // Cập nhật danh sách friend cho cả 2 user
                await accountModel.updateOne({ username: request.from }, { $addToSet: { friends: request.to } });
                await accountModel.updateOne({ username: request.to }, { $addToSet: { friends: request.from } });
            }
            client.emit('respondFriendRequestResult', { success: true, message: `Lời mời đã được ${action}` });
        } catch (err) {
            console.error(err);
            client.emit('respondFriendRequestResult', { success: false, message: "Lỗi server" });
        }
    });

    // Lấy danh sách lời mời kết bạn cho user
    client.on('getFriendRequests', async (username) => {
        try {
            const requests = await FriendRequest.find({ to: username, status: 'pending' });
            client.emit('friendRequests', requests);
        } catch (err) {
            console.error("Error fetching friend requests", err);
            client.emit('friendRequests', []);
        }
    });

    // Lấy danh sách friend của user
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
});

// API HTTP (nếu cần)
app.post('/add-friend', async (req, res) => {
    const { myUsername, friendUsername } = req.body;
    try {
        const user = await accountModel.findOne({ username: myUsername });
        if (!user) return res.status(404).json({ message: 'User không tồn tại' });
        return res.json({ message: `Gửi lời mời kết bạn đến ${friendUsername} thành công` });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Lỗi server' });
    }
});

connectDB();
router(app);

server.listen(5000, (req, res) => {
    console.log('Server is running on port 5000');
});
