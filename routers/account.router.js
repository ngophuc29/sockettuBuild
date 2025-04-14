const express = require('express');
// const router = express.Router();
// const {
//  login,register,getAccounts
// }= require('../controllers/account.controller')


// router
//     .route("/login")
//     .post(login)

// router
//     .route("/register")
//     .post(register)
// router.route("/").get(getAccounts);  // Thêm route này
// module.exports = router; 
const router = express.Router();
const accountController = require('../controllers/account.controller');

router.post('/register-step1', accountController.registerUserStep1);

router.post('/register-step2', accountController.registerUserStep2);

router.post('/login', accountController.loginUser);

router.post('/forgot-password', accountController.forgotPassword);

router.post('/reset-password', accountController.resetPassword);

router.post('/verify-otp', accountController.verifyOTP);
router.get('/', accountController.getAccounts);
router.get('/username/:username', accountController.getAccountByUsername);

// Cập nhật thông tin tài khoản
router.put('/:username', accountController.updateUserProfile);

router.put('/change-password/:username', accountController.changePassword);

router.get('/check-email', accountController.checkEmail);
 
router.get('/check-username', accountController.checkUsername);
 
router.get('/check-phone', accountController.checkPhone);
module.exports = router;
