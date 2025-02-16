
const accountRouter = require('./account.router');
const viewRouter = require('./view.router');
module.exports = (app) => {
    app.use("/", viewRouter)

    app.use('/api/accounts', accountRouter)

    
}