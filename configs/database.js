const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        await mongoose.connect("mongodb://localhost:27017/demoChatSocket")
        console.log("Connect to database successfully")
        
    } catch (error) {
        console.log("Connect to database failed"+error.message)
    }
}

module.exports = connectDB