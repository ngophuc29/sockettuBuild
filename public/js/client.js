const inputmessage = document.getElementById("message");
const btn_send = document.getElementById("btn_send");
const ul_message = document.getElementById("ul_message");
const socket = io.connect();

let myname = localStorage.getItem("username") || myUsername;
let currentRoom = localStorage.getItem("currentRoom") || null;
let currentChatPartner = null;
let activeChats = JSON.parse(localStorage.getItem("activeChats")) || {};

const emotions = [
    { id: 1, emotion: `<i class="fa-solid fa-heart"></i>` },
    { id: 2, emotion: `<i class="fa-solid fa-face-laugh-wink"></i>` },
    { id: 3, emotion: `<i class="fa-regular fa-face-surprise"></i>` },
    { id: 4, emotion: `<i class="fa-regular fa-face-rolling-eyes"></i>` },
    { id: 5, emotion: `<i class="fa-solid fa-face-angry"></i>` }
];

// Hàm displayReaction: hiển thị reaction lên tin nhắn theo reaction.messageId
function displayReaction(reaction) {
    const span_message = document.getElementById(reaction.messageId);
    if (!span_message) {
        console.error("Không tìm thấy phần tử với messageId:", reaction.messageId);
        return;
    }
    span_message.style.position = "relative";
    let emotionHTML = emotions[reaction.emotion - 1].emotion;
    const div = document.createElement("div");
    div.innerHTML = emotionHTML;
    let emotionElem = div.firstChild;
    emotionElem.style.position = "absolute";
    emotionElem.style.bottom = "-7px";
    emotionElem.style.right = "4px";
    emotionElem.style.backgroundColor = "blue";
    emotionElem.style.borderRadius = "10px";
    emotionElem.style.padding = "3px";
    span_message.appendChild(emotionElem);
}

socket.on("connect", () => {
    console.log("Connected to socket.io server");
    if (currentRoom) {
        socket.emit("join", currentRoom);
    }
});

// Khi nhận "history", hiển thị tin nhắn từ DB
socket.on("history", (data) => {
    const history = JSON.parse(data);
    console.log("Received chat history for room:", currentRoom, history);
    ul_message.innerHTML = "";
    history.forEach((msg) => {
        appendMessage(msg);
    });
    localStorage.setItem("chat_" + currentRoom, JSON.stringify(history));
});

// Khi nhận "reactionHistory", hiển thị các reaction đã lưu từ DB
socket.on("reactionHistory", (data) => {
    const reactions = JSON.parse(data);
    console.log("Received reaction history for room:", currentRoom, reactions);
    reactions.forEach((reaction) => {
        displayReaction(reaction);
    });
});

const sendMessage = () => {
    if (!currentRoom) {
        alert("Vui lòng chọn user hoặc cuộc chat để chat.");
        return;
    }
    const message = inputmessage.value;
    if (message === "") return;

    const obj = {
        id: Date.now(), // tạo id duy nhất
        name: myname,
        message: message,
        room: currentRoom
    };
    socket.emit("message", JSON.stringify(obj));
    inputmessage.value = "";
    inputmessage.focus();
};
btn_send.addEventListener("click", sendMessage);
inputmessage.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendMessage();
});

function appendMessage(obj) {
    const msgId = obj._id ? obj._id : obj.id;
    if (document.getElementById(msgId)) return;

    const li = document.createElement("li");
    li.innerHTML = `
        <span id="${msgId}">
            <p>${obj.message}</p>
        </span>
        <div>
            <i onclick="show(event, '${msgId}')" class="choose_emotion fa-regular fa-face-smile"></i>
        </div>
    `;
    if (obj.name === myname) {
        li.classList.add("right");
    }
    ul_message.appendChild(li);
    ul_message.scrollTop = ul_message.scrollHeight;
}

// (Tùy chọn) Lưu tin nhắn vào localStorage cho demo cache
function saveMessage(messageObj) {
    if (!messageObj.room) return;
    const key = "chat_" + messageObj.room;
    let chatHistory = JSON.parse(localStorage.getItem(key)) || [];
    if (!chatHistory.find(msg => msg.id === messageObj.id || msg._id === messageObj._id)) {
        chatHistory.push(messageObj);
        localStorage.setItem(key, JSON.stringify(chatHistory));
    }
}

socket.on("thread", (data) => {
    const obj = JSON.parse(data);
    console.log("Thread received:", obj, "Current room:", currentRoom);
    saveMessage(obj);
    if (obj.room === currentRoom) {
        appendMessage(obj);
    } else {
        if (activeChats[obj.room]) {
            activeChats[obj.room].unread = (activeChats[obj.room].unread || 0) + 1;
        } else {
            activeChats[obj.room] = { partner: obj.name, unread: 1 };
        }
        localStorage.setItem("activeChats", JSON.stringify(activeChats));
        updateChatList();
        alert("Có tin nhắn mới từ " + obj.name + ": " + obj.message);
    }
});

socket.on("notification", (data) => {
    const obj = JSON.parse(data.message);
    if (obj.room !== currentRoom) {
        if (activeChats[obj.room]) {
            activeChats[obj.room].unread = (activeChats[obj.room].unread || 0) + 1;
        } else {
            activeChats[obj.room] = { partner: obj.name, unread: 1 };
        }
        localStorage.setItem("activeChats", JSON.stringify(activeChats));
        updateChatList();
    }
});

function updateChatList() {
    const chatListUl = document.getElementById("chat_list_ul");
    chatListUl.innerHTML = "";
    for (const room in activeChats) {
        const chatItem = document.createElement("li");
        chatItem.style.cursor = "pointer";
        chatItem.style.padding = "5px";
        chatItem.style.borderBottom = "1px solid #ddd";
        let partnerName = activeChats[room].partner;
        let unread = activeChats[room].unread || 0;

        chatItem.textContent = partnerName;
        if (unread > 0) {
            let badge = document.createElement("span");
            badge.style.backgroundColor = "red";
            badge.style.color = "white";
            badge.style.borderRadius = "50%";
            badge.style.padding = "2px 5px";
            badge.style.marginLeft = "5px";
            badge.textContent = unread;
            chatItem.appendChild(badge);
        }
        chatItem.addEventListener("click", () => {
            if (currentRoom !== room) {
                if (currentRoom && currentRoom !== room) {
                    socket.emit("leave", currentRoom);
                }
                currentRoom = room;
                currentChatPartner = activeChats[room].partner;
                activeChats[room].unread = 0;
                localStorage.setItem("activeChats", JSON.stringify(activeChats));
                updateChatList();
                socket.emit("join", room);
                localStorage.setItem("currentRoom", currentRoom);
            }
        });
        chatListUl.appendChild(chatItem);
    }
}
updateChatList();

const listUser = document.querySelectorAll('.list_user li');
listUser.forEach(item => {
    item.addEventListener('click', () => {
        const usernameElement = item.querySelector('p');
        const targetUser = usernameElement.textContent.trim();
        if (targetUser === myname) return;

        const room = [myname, targetUser].sort().join('-');
        if (currentRoom && currentRoom !== room) {
            socket.emit('leave', currentRoom);
        }
        currentRoom = room;
        currentChatPartner = targetUser;
        socket.emit("join", room);
        ul_message.innerHTML = "";
        // Khi join, server sẽ gửi "history" từ DB
        activeChats[room] = { partner: targetUser, unread: 0 };
        localStorage.setItem("activeChats", JSON.stringify(activeChats));
        updateChatList();
        localStorage.setItem("currentRoom", currentRoom);
        alert("Chat với " + targetUser);
    });
});

const searchUserInput = document.getElementById("search_user");
searchUserInput.addEventListener("input", function () {
    const filter = searchUserInput.value.toLowerCase();
    listUser.forEach(item => {
        const username = item.querySelector("p").textContent.toLowerCase();
        item.style.display = username.indexOf(filter) > -1 ? "" : "none";
    });
});

function show(e, id) {
    if (e.target.classList.contains("choose_emotion")) {
        if (e.target.innerHTML.toString().trim().length === 0) {
            e.target.innerHTML = `
                <div class="emotion">
                    <i onclick="choose(event, '${id}', 1)" class="fa-solid fa-heart"></i>
                    <i onclick="choose(event, '${id}', 2)" class="fa-solid fa-face-laugh-wink"></i>
                    <i onclick="choose(event, '${id}', 3)" class="fa-regular fa-face-surprise"></i>
                    <i onclick="choose(event, '${id}', 4)" class="fa-regular fa-face-rolling-eyes"></i>
                    <i onclick="choose(event, '${id}', 5)" class="fa-solid fa-face-angry"></i>
                </div>`;
        } else {
            e.target.innerHTML = "";
        }
    }
}

function choose(e, id, id_emotion) {
    const span_message = document.getElementById(id);
    if (!span_message) {
        console.error("Không tìm thấy phần tử với id:", id);
        return;
    }
    span_message.style.position = "relative";
    const emotionElem = e.target.cloneNode(true);
    emotionElem.style.position = "absolute";
    emotionElem.style.bottom = "-7px";
    emotionElem.style.right = "4px";
    emotionElem.style.backgroundColor = "blue";
    emotionElem.style.borderRadius = "10px";
    emotionElem.style.padding = "3px";
    span_message.appendChild(emotionElem);

    // Tạo đối tượng reaction với trường messageId và room
    const reactionData = {
        messageId: id,         // Sử dụng id của tin nhắn làm messageId
        user: myname,          // Tên người gửi reaction
        emotion: id_emotion,   // Loại emotion (1-5)
        room: currentRoom      // Room hiện hành
    };
    socket.emit("emotion", JSON.stringify(reactionData));
}

socket.on("emotion", (data) => {
    const obj = JSON.parse(data);
    // Sử dụng obj.messageId để lấy DOM của tin nhắn cần hiển thị reaction
    const span_message = document.getElementById(obj.messageId);
    if (!span_message) {
        console.error("Không tìm thấy phần tử với messageId:", obj.messageId);
        return;
    }
    span_message.style.position = "relative";
    let emotionHTML = emotions[obj.emotion - 1].emotion;
    const div = document.createElement("div");
    div.innerHTML = emotionHTML;
    let emotionElem = div.firstChild;
    emotionElem.style.position = "absolute";
    emotionElem.style.bottom = "-7px";
    emotionElem.style.right = "4px";
    emotionElem.style.backgroundColor = "blue";
    emotionElem.style.borderRadius = "10px";
    emotionElem.style.padding = "3px";
    span_message.appendChild(emotionElem);
});
