const User = require('../models/account.model'); // hoặc user.model nếu bạn đổi tên
const OTP = require('../models/OTP');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sendEmail = require('../utils/sendEmail');
const emailExistence = require('email-existence');
const sharp = require('sharp');

// Tạo mã OTP ngẫu nhiên
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Step 1: Gửi OTP để xác minh email
const registerUserStep1 = async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Vui lòng cung cấp email' });

    try {
        const userExists = await User.findOne({ email });
        if (userExists) {
            return res.status(400).json({ message: 'Email đã được đăng ký' });


        }

        // // Sử dụng email-existence để kiểm tra email có tồn tại thực sự
        // emailExistence.check(email, async (err, exists) => {
        //     if (err) {
        //         console.error('Lỗi khi kiểm tra email:', err);
        //         return res.status(500).json({ message: 'Lỗi khi kiểm tra email', error: err.message });
        //     }

        //     if (!exists) {
        //         return res.status(400).json({ message: 'Email không tồn tại trên hệ thống thực tế' });
        //     }

        //     // Nếu email tồn tại, tiến hành gửi OTP
        //     const otp = generateOTP();

        //     try {
        //         await sendEmail(email, 'Xác nhận đăng ký', `Mã OTP của bạn là: ${otp}`);
        //     } catch (error) {
        //         return res.status(400).json({
        //             message: 'Không gửi được email. Có thể email không tồn tại hoặc bị lỗi.',
        //             error: error.message
        //         });
        //     }

        //     await OTP.create({ email, otp, expiration: Date.now() + 10 * 60 * 1000 });
        //     return res.status(200).json({ message: 'Đã gửi OTP tới email' });
        // });


        //     // Nếu email tồn tại, tiến hành gửi OTP
            const otp = generateOTP();

            try {
                await sendEmail(email, 'Xác nhận đăng ký', `Mã OTP của bạn là: ${otp}`);
            } catch (error) {
                return res.status(400).json({
                    message: 'Không gửi được email. Có thể email không tồn tại hoặc bị lỗi.',
                    error: error.message
                });
            }

            await OTP.create({ email, otp, expiration: Date.now() + 10 * 60 * 1000 });
            return res.status(200).json({ message: 'Đã gửi OTP tới email' });
    } catch (error) {
        return res.status(500).json({ message: 'Lỗi server', error: error.message });
    }
};

// Step 2: Đăng ký sau khi xác thực OTP
const registerUserStep2 = async (req, res) => {
    const { username, password, phone, email, birthday, fullname, image } = req.body;

    if (!username || !password || !fullname || !phone) {
        return res.status(400).json({ message: 'Thiếu thông tin bắt buộc' });
    }

    try {
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ message: 'Tên đăng nhập đã tồn tại' });

        const existingPhone = await User.findOne({ phone });
        if (existingPhone) return res.status(400).json({ message: 'Số điện thoại đã tồn tại' });

        if (email) {
            const existingEmail = await User.findOne({ email });
            if (existingEmail) return res.status(400).json({ message: 'Email đã tồn tại' });
        }

        let compressedImage = null;

        if (image) {
            const buffer = Buffer.from(image.split(',')[1], 'base64');
            const outputBuffer = await sharp(buffer)
                .resize({ width: 100 })
                .jpeg({ quality: 10 })
                .toBuffer();
            compressedImage = `data:image/jpeg;base64,${outputBuffer.toString('base64')}`;
        }

        const user = new User({
            username,
            password,
            phone,
            email,
            birthday,
            fullname,
            image: compressedImage,
        });

        await user.save();

        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        // Emit sự kiện cho các client khác
        // req.app.get('io').emit('new_user', {
        //     id: user._id,
        //     username: user.username,
        //     phone: user.phone,
        //     fullname: user.fullname,
        //     image: user.image,
        // });

        res.status(201).json({
            message: 'Đăng ký thành công',
            token,
            user: {
                id: user._id,
                username: user.username,
                phone: user.phone,
                email: user.email,
                fullname: user.fullname,
                image: user.image,
                birthday: user.birthday
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server', error: error.message });
    }
};

// Login bằng username, phone hoặc email + password
const loginUser = async (req, res) => {
    const { username, phone, email, password } = req.body;

    if (!password || (!username && !phone && !email)) {
        return res.status(400).json({ message: 'Vui lòng cung cấp tài khoản và mật khẩu' });
    }

    try {
        const user = await User.findOne({
            $or: [{ username }, { phone }, { email }]
        });

        if (!user) return res.status(404).json({ message: 'Tài khoản không tồn tại' });

        const isMatch = await user.matchPassword(password);
        if (!isMatch) return res.status(400).json({ message: 'Mật khẩu không đúng' });

        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.status(200).json({ message: 'Đăng nhập thành công', token, username: user.username });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server', error: error.message });
    }
};

// Quên mật khẩu
const forgotPassword = async (req, res) => {
    const { email } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: 'Email không tồn tại' });

        const otp = generateOTP();
        await sendEmail(email, 'Xác nhận quên mật khẩu', `Mã OTP của bạn là: ${otp}`);

        await OTP.create({ email, otp, expiration: Date.now() + 10 * 60 * 1000 });

        res.status(200).json({ message: 'Đã gửi OTP đến email' });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server', error: error.message });
    }
};

// Đặt lại mật khẩu
const resetPassword = async (req, res) => {
    const { email, newPassword } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: 'Không tìm thấy người dùng' });

        user.password = newPassword;
        await user.save();

        res.status(200).json({ message: 'Đặt lại mật khẩu thành công' });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server', error: error.message });
    }
};

// Xác minh OTP
const verifyOTP = async (req, res) => {
    const { email, otp } = req.body;

    try {
        const record = await OTP.findOne({ email, otp });
        if (!record) return res.status(400).json({ message: 'OTP không hợp lệ' });

        if (record.expiration < Date.now()) {
            return res.status(400).json({ message: 'OTP đã hết hạn' });
        }

        await OTP.deleteOne({ _id: record._id });
        res.status(200).json({ message: 'OTP hợp lệ' });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server', error: error.message });
    }
};

// Lấy danh sách tài khoản
const getAccounts = async (req, res) => {
    try {
        const users = await User.find();
        res.status(200).json(users);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server', error: error.message });
    }
};

const getAccountByUsername = async (req, res) => {
    const { username } = req.params;

    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ message: 'Không tìm thấy người dùng' });
        }
        res.status(200).json(user);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server', error: error.message });
    }
};
//  Check xem email đã được đăng ký hay chưa
const checkEmail = async (req, res) => {
    const { email } = req.query;
    if (!email) {
        return res.status(400).json({ message: 'Vui lòng cung cấp email' });
    }

    try {
        const user = await User.findOne({ email });
        if (user) {
            return res.status(200).json({ exists: true, message: 'Email đã được đăng ký' });
        } else {
            return res.status(200).json({ exists: false, message: 'Email chưa được đăng ký' });
        }
    } catch (error) {
        return res.status(500).json({ message: 'Lỗi server', error: error.message });
    }
};
const updateUserProfile = async (req, res) => {
    const { username } = req.params;
    const { fullname, birthday, image } = req.body;

    try {
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ message: 'Không tìm thấy người dùng' });

        if (fullname) user.fullname = fullname;
        if (birthday) user.birthday = birthday;

        if (image) {
            const buffer = Buffer.from(image.split(',')[1], 'base64');
            const outputBuffer = await sharp(buffer)
                .resize({ width: 100 })
                .jpeg({ quality: 10 })
                .toBuffer();
            user.image = `data:image/jpeg;base64,${outputBuffer.toString('base64')}`;
        }

        await user.save();

        res.status(200).json({
            message: 'Update successful',
            user: {
                username: user.username,
                fullname: user.fullname,
                birthday: user.birthday,
                image: user.image
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server', error: error.message });
    }


};
// Hàm đổi mật khẩu cho người dùng đã đăng nhập
// Route: PUT /api/accounts/change-password/:username

const changePassword = async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const { username } = req.params;

    console.log('Change password request:', { username, oldPassword, newPassword });

    if (!username || !oldPassword || !newPassword) {
        return res.status(400).json({ message: 'Vui lòng cung cấp đầy đủ username, mật khẩu cũ và mật khẩu mới' });
    }

    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ message: 'Không tìm thấy người dùng' });
        }

        const isMatch = await user.matchPassword(oldPassword);
        if (!isMatch) {
            return res.status(400).json({ message: 'Mật khẩu cũ không đúng' });
        }

        user.password = newPassword;
        await user.save();

        return res.status(200).json({ message: 'Password updated' });
    } catch (error) {
        return res.status(500).json({ message: 'Lỗi server', error: error.message });
    }




};
//  Check xem email đã được đăng ký hay chưa
const checkUsername = async (req, res) => {
    const { username } = req.query;
    if (!username) {
        return res.status(400).json({ message: 'Vui lòng cung cấp username' });
    }

    try {
        const user = await User.findOne({ username });
        if (user) {
            return res.status(200).json({ exists: true, message: 'Username đã được đăng ký' });
        } else {
            return res.status(200).json({ exists: false, message: 'Username chưa được đăng ký' });
        }
    } catch (error) {
        return res.status(500).json({ message: 'Lỗi server', error: error.message });
    }
};

const checkPhone = async (req, res) => {
    const { phone } = req.query;
    if (!phone) {
        return res.status(400).json({ message: 'Vui lòng cung cấp phone ' });
    }

    try {
        const user = await User.findOne({ phone });
        if (user) {
            return res.status(200).json({ exists: true, message: 'phone  đã được đăng ký' });
        } else {
            return res.status(200).json({ exists: false, message: 'phone  chưa được đăng ký' });
        }
    } catch (error) {
        return res.status(500).json({ message: 'Lỗi server', error: error.message });
    }
};

module.exports = {
    registerUserStep1,
    registerUserStep2,
    loginUser,
    forgotPassword,
    resetPassword,
    verifyOTP,
    getAccounts,
    getAccountByUsername,
    updateUserProfile,
    checkEmail, changePassword, checkUsername, checkPhone
};