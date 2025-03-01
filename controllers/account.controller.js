const accountModel = require('../models/account.model')

module.exports = {
    register: async (req, res) => {
        const body = req.body;
        // Yêu cầu các trường username, password, fullname và phone đều có mặt
        if (!body.username || !body.password || !body.fullname || !body.phone) {
            return res.status(400).json({ message: "Thiếu thông tin bắt buộc" });
        }
        try {
            const newAccount = await accountModel.create(body);
            return res.status(201).json(newAccount);
        } catch (err) {
            return res.status(500).json({ message: "Lỗi server", error: err });
        }
    },
    login: async (req, res) => {
        const body = req.body;
        let account;
        try {
            // Nếu có trường phone thì đăng nhập bằng phone, ngược lại dùng username
            if (body.phone) {
                account = await accountModel.findOne({
                    phone: body.phone,
                    password: body.password
                });
            } else {
                account = await accountModel.findOne({
                    username: body.username,
                    password: body.password
                });
            }
            if (!account) {
                return res.status(404).json({
                    statusCode: 404,
                    message: 'Tài khoản hoặc mật khẩu không đúng'
                });
            }
            return res.status(200).json(account);
        } catch (err) {
            return res.status(500).json({ message: "Lỗi server", error: err });
        }
    },
    getAccounts: async (req, res) => {
        try {
            const accounts = await accountModel.find();
            return res.status(200).json(accounts);
        } catch (err) {
            return res.status(500).json({ message: "Lỗi server" });
        }
    }
}
