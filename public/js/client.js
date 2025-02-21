/************************************
 * PHẦN 1: CHỨC NĂNG CHAT (CODE CŨ)
 ************************************/
const inputmessage = document.getElementById("message");
const btn_send = document.getElementById("btn_send");
const ul_message = document.getElementById("ul_message");
const socket = io.connect();

// Đăng ký username ngay khi kết nối
let myname = localStorage.getItem("username") || myUsername;
socket.emit("registerUser", myname);

let currentRoom = localStorage.getItem("currentRoom") || null;
let currentChatPartner = null;
// activeChats lưu theo room, với mỗi entry: { partner, unread, isGroup }
let activeChats = JSON.parse(localStorage.getItem("activeChats")) || {};

const emotions = [
    { id: 1, emotion: `<i class="fa-solid fa-heart"></i>` },
    { id: 2, emotion: `<i class="fa-solid fa-face-laugh-wink"></i>` },
    { id: 3, emotion: `<i class="fa-regular fa-face-surprise"></i>` },
    { id: 4, emotion: `<i class="fa-regular fa-face-rolling-eyes"></i>` },
    { id: 5, emotion: `<i class="fa-solid fa-face-angry"></i>` }
];

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
    // Yêu cầu load tất cả cuộc trò chuyện của user
    socket.emit("getUserConversations", myname);
});

socket.on("history", (data) => {
    const history = JSON.parse(data);
    console.log("Received chat history for room:", currentRoom, history);
    ul_message.innerHTML = "";
    history.forEach((msg) => {
        appendMessage(msg);
    });
    localStorage.setItem("chat_" + currentRoom, JSON.stringify(history));
});

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
        id: Date.now(),
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
    li.id = "msg-" + msgId;
    li.innerHTML = `
        <div class="sender-name" style="font-weight:bold; margin-bottom:2px;">${obj.name}</div>
        <span id="${msgId}">
            <p>${obj.message}</p>
        </span>
        <div>
            <i onclick="show(event, '${msgId}')" class="choose_emotion fa-regular fa-face-smile"></i>
            ${obj.name === myname ? `<button class="btn_delete" onclick="deleteMessage('${msgId}', '${obj.room}')">X</button>` : ""}
        </div>
    `;
    if (obj.name === myname) {
        li.classList.add("right");
    }
    ul_message.appendChild(li);
    ul_message.scrollTop = ul_message.scrollHeight;
}

function saveMessage(messageObj) {
    if (!messageObj.room) return;
    const key = "chat_" + messageObj.room;
    let chatHistory = JSON.parse(localStorage.getItem(key)) || [];
    if (!chatHistory.find(msg => msg.id === messageObj.id || msg._id === messageObj._id)) {
        chatHistory.push(messageObj);
        localStorage.setItem(key, JSON.stringify(chatHistory));
    }
}

// Hàm gửi yêu cầu xóa tin nhắn với xác nhận
function deleteMessage(msgId, room) {
    if (confirm("Bạn có chắc muốn xóa tin nhắn này không?")) {
        socket.emit("deleteMessage", { messageId: msgId, room: room });
    }
}

// Khi nhận event tin nhắn đã bị xóa, loại bỏ khỏi UI
socket.on("messageDeleted", (data) => {
    const obj = JSON.parse(data);
    const li = document.getElementById("msg-" + obj.messageId);
    if (li) {
        li.remove();
    }
});

socket.on("deleteMessageResult", (data) => {
    alert(data.message);
});

// Xử lý nhận tin nhắn mới (thread)
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
            if (obj.room.indexOf('_') > -1) {
                activeChats[obj.room] = { partner: obj.groupName ? obj.groupName : "Group Chat", unread: 1, isGroup: true };
            } else {
                activeChats[obj.room] = { partner: obj.name, unread: 1 };
            }
        }
        localStorage.setItem("activeChats", JSON.stringify(activeChats));
        updateChatList();
        alert("Có tin nhắn mới từ " + obj.name + ": " + obj.message);
    }
});

// Xử lý event "notification"
socket.on("notification", (data) => {
    console.log("Notification received:", data);
    const obj = JSON.parse(data.message);
    const roomNotified = data.room;
    if (roomNotified !== currentRoom) {
        if (activeChats[roomNotified]) {
            activeChats[roomNotified].unread = (activeChats[roomNotified].unread || 0) + 1;
        } else {
            let partnerName = roomNotified.indexOf('_') > -1 ? (obj.groupName ? obj.groupName : "Group Chat") : obj.name;
            activeChats[roomNotified] = { partner: partnerName, unread: 1, isGroup: roomNotified.indexOf('_') > -1 };
        }
        localStorage.setItem("activeChats", JSON.stringify(activeChats));
        updateChatList();
    }
});

// Khi nhận dữ liệu cuộc trò chuyện từ server, merge vào activeChats mà không mất các entry cũ
socket.on("userConversations", (data) => {
    const conversations = JSON.parse(data);
    if (conversations.groupChats && conversations.groupChats.length > 0) {
        conversations.groupChats.forEach(group => {
            if (!activeChats[group.roomId]) {
                activeChats[group.roomId] = { partner: group.groupName, unread: group.unread || 0, isGroup: true };
            } else {
                activeChats[group.roomId].unread = group.unread || activeChats[group.roomId].unread;
            }
        });
    }
    if (conversations.privateChats && conversations.privateChats.length > 0) {
        conversations.privateChats.forEach(chat => {
            const roomId = chat.roomId || chat.room;
            if (!activeChats[roomId]) {
                activeChats[roomId] = { partner: chat.friend, unread: chat.unread || 0 };
            } else {
                activeChats[roomId].unread = chat.unread || activeChats[roomId].unread;
            }
        });
    }
    localStorage.setItem("activeChats", JSON.stringify(activeChats));
    updateChatList();
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

const listUser = document.querySelectorAll('#chat_mode .list_user li');
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
    const reactionData = {
        messageId: id,
        user: myname,
        emotion: id_emotion,
        room: currentRoom
    };
    socket.emit("emotion", JSON.stringify(reactionData));
}

socket.on("emotion", (data) => {
    const obj = JSON.parse(data);
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

/************************************
 * PHẦN 2: FRIEND FUNCTIONALITY
 ************************************/
const navMessages = document.getElementById('nav_messages');
const navContacts = document.getElementById('nav_contacts');
const chatMode = document.getElementById('chat_mode');
const contactsMode = document.getElementById('contacts_mode');

navMessages.addEventListener('click', () => {
    chatMode.style.display = 'block';
    contactsMode.style.display = 'none';
});
navContacts.addEventListener('click', () => {
    chatMode.style.display = 'none';
    contactsMode.style.display = 'block';
    loadFriendRequests();
    loadFriends();
});

function updateContactButtons() {
    const buttons = document.querySelectorAll('#contacts_list .btn_add_friend');
    buttons.forEach(button => {
        const username = button.getAttribute('data-username');
        if (username === myname) {
            button.style.display = 'none';
            return;
        }
        if (myFriends.includes(username)) {
            button.textContent = "Hủy kết bạn";
            button.onclick = function (e) {
                e.stopPropagation();
                socket.emit('cancelFriend', { myUsername: myname, friendUsername: username });
            };
        } else {
            button.textContent = "Kết bạn";
            button.onclick = function (e) {
                e.stopPropagation();
                socket.emit('addFriend', { myUsername: myname, friendUsername: username });
            };
        }
    });
}

function loadFriendRequests() {
    socket.emit('getFriendRequests', myname);
}
socket.on('friendRequests', (requests) => {
    const friendRequestsContainer = document.getElementById('friend_requests_container');
    friendRequestsContainer.innerHTML = "";
    if (requests.length === 0) {
        friendRequestsContainer.innerHTML = "<li>Không có lời mời kết bạn mới</li>";
    } else {
        requests.forEach(req => {
            const li = document.createElement('li');
            li.style.padding = '5px';
            li.style.borderBottom = '1px solid #ddd';
            li.textContent = `Từ: ${req.from}`;
            const acceptBtn = document.createElement('button');
            acceptBtn.textContent = "Chấp nhận";
            acceptBtn.style.marginLeft = '10px';
            acceptBtn.onclick = () => {
                socket.emit('respondFriendRequest', { requestId: req._id, action: 'accepted' });
            };
            const rejectBtn = document.createElement('button');
            rejectBtn.textContent = "Từ chối";
            rejectBtn.style.marginLeft = '5px';
            rejectBtn.onclick = () => {
                socket.emit('respondFriendRequest', { requestId: req._id, action: 'rejected' });
            };
            li.appendChild(acceptBtn);
            li.appendChild(rejectBtn);
            friendRequestsContainer.appendChild(li);
        });
    }
});

function loadFriends() {
    socket.emit('getFriends', myname);
}
socket.on('friendsList', (friends) => {
    myFriends = friends;
    const friendsContainer = document.getElementById('friends_container');
    friendsContainer.innerHTML = "";
    if (friends.length === 0) {
        friendsContainer.innerHTML = "<li>Chưa có bạn bè nào</li>";
    } else {
        friends.forEach(friend => {
            const li = document.createElement('li');
            li.textContent = friend;
            li.style.padding = '5px';
            li.style.borderBottom = '1px solid #ddd';
            friendsContainer.appendChild(li);
        });
    }
    updateContactButtons();
});

socket.on('cancelFriendResult', (data) => {
    if (data.success) {
        loadFriends();
        loadFriendRequests();
        alert(data.message);
    } else {
        alert(data.message);
    }
});
socket.on('addFriendResult', (data) => {
    if (data.success) {
        loadFriendRequests();
    } else {
        alert(data.message);
    }
});
socket.on('respondFriendRequestResult', (data) => {
    if (data.success) {
        loadFriendRequests();
        loadFriends();
        alert(data.message);
    } else {
        alert(data.message);
    }
});

const searchContactsInput = document.getElementById("search_contacts");
searchContactsInput.addEventListener("input", function () {
    const filter = searchContactsInput.value.toLowerCase();
    const contactItems = document.querySelectorAll('#contacts_list li');
    contactItems.forEach(item => {
        const username = item.querySelector("p").textContent.toLowerCase();
        item.style.display = username.indexOf(filter) > -1 ? "" : "none";
    });
    updateContactButtons();
});

/************************************
 * PHẦN 3: GROUP CHAT FUNCTIONALITY
 ************************************/
const btnCreateGroup = document.getElementById("btn_create_group");
const groupModal = document.getElementById("groupModal");
const closeModal = document.getElementById("closeModal");
const createGroupBtn = document.getElementById("createGroupBtn");

btnCreateGroup.addEventListener("click", () => {
    groupModal.style.display = "block";
});
closeModal.addEventListener("click", () => {
    groupModal.style.display = "none";
});
window.addEventListener("click", (event) => {
    if (event.target == groupModal) {
        groupModal.style.display = "none";
    }
});
createGroupBtn.addEventListener("click", () => {
    const groupName = document.getElementById("groupName").value;
    if (!groupName) {
        alert("Vui lòng nhập tên nhóm");
        return;
    }
    const checkboxes = document.querySelectorAll(".memberCheckbox");
    const members = [];
    checkboxes.forEach(chk => {
        if (chk.checked) {
            members.push(chk.value);
        }
    });
    if (members.length === 0) {
        alert("Chọn ít nhất 1 thành viên");
        return;
    }
    socket.emit("createGroupChat", { groupName, members });
    groupModal.style.display = "none";
});

// Nhận sự kiện "newGroupChat" từ server
socket.on("newGroupChat", (data) => {
    const groupChat = JSON.parse(data);
    if (!activeChats[groupChat.roomId]) {
        activeChats[groupChat.roomId] = { partner: groupChat.groupName, unread: 0, isGroup: true };
        localStorage.setItem("activeChats", JSON.stringify(activeChats));
        updateChatList();
        alert("Đã tạo nhóm chat: " + groupChat.groupName);
    }
});

// Load danh sách cuộc trò chuyện khi đăng nhập
socket.emit("getUserConversations", myname);
socket.on("userConversations", (data) => {
    const conversations = JSON.parse(data);
    if (conversations.groupChats && conversations.groupChats.length > 0) {
        conversations.groupChats.forEach(group => {
            if (!activeChats[group.roomId]) {
                activeChats[group.roomId] = { partner: group.groupName, unread: group.unread || 0, isGroup: true };
            } else {
                activeChats[group.roomId].unread = group.unread || activeChats[group.roomId].unread;
            }
        });
    }
    if (conversations.privateChats && conversations.privateChats.length > 0) {
        conversations.privateChats.forEach(chat => {
            const roomId = chat.roomId || chat.room;
            if (!activeChats[roomId]) {
                activeChats[roomId] = { partner: chat.friend, unread: chat.unread || 0 };
            } else {
                activeChats[roomId].unread = chat.unread || activeChats[roomId].unread;
            }
        });
    }
    localStorage.setItem("activeChats", JSON.stringify(activeChats));
    updateChatList();
});

function renderUserConversations(conversations) {
    updateChatList();
}
