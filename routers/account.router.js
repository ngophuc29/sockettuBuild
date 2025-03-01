const express = require('express');
const router = express.Router();
const {
 login,register,getAccounts
}= require('../controllers/account.controller')


router
    .route("/login")
    .post(login)

router
    .route("/register")
    .post(register)
router.route("/").get(getAccounts);  // Thêm route này
module.exports = router; 