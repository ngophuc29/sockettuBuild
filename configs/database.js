const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        await mongoose.connect("mongodb+srv://ngophuc2911:phuc29112003@cluster0.9wvzd5u.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0")
        // mongodb+srv://ngophuc2911:<db_password>@cluster0.9wvzd5u.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
        // mongodb://localhost:27017/demoChatSocket
        console.log("Connect to database successfully")
        
    } catch (error) {
        console.log("Connect to database failed"+error.message)
    }
}

module.exports = connectDB