const express = require('express')

const router = express.Router()
const {renderChat}=require('../controllers/view.controller')
router
    .route("/")
    .get((req, res) => {
        return res.render('login.ejs')
    })

router
    .route("/chat")
    .get(renderChat)

module.exports = router