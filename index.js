const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);

const connectDB = require('./configs/database');
const router = require('./routers');

// Import model Message và Reaction
const Message = require('./models/message.model');
const Reaction = require('./models/reaction.model');

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
                messageId: reactionObj.messageId, // ID của tin nhắn được reaction
                room: reactionObj.room,           // room được gửi từ client
                user: reactionObj.user,
                emotion: reactionObj.emotion
            });
        } catch (err) {
            console.error("Error saving reaction:", err);
        }
        io.to(room).emit("emotion", data);
    });
});

connectDB();
router(app);

server.listen(5000, (req, res) => {
    console.log('Server is running on port 5000');
});
