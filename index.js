require('dotenv').config();

const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const Joi = require('joi');

const path = require('path');
const { PassThrough } = require('stream');
const app = express();

app.set('view engine', 'ejs');

const port = 7000;
app.use(express.static('./public'));
app.use(express.urlencoded({extended: false}));

let imagePaths = {
    1: "/images/breaking-cell.jpg",
    2: "/images/breaking-back.jpg",
    3: "/images/baking-bread.jpg" 
};

/*
MongoDB Connection
 */
const MongoClient = require('mongodb').MongoClient;
const atlasURI = `mongodb+srv://${process.env.MONGODB_USER}:${process.env.MONGODB_PASSWORD}@${process.env.MONGODB_HOST}/${process.env.MONGODB_DATABASE}`;
let database;
async function connectToMongoDB() {
    const mongoDBConnection = await MongoClient.connect(atlasURI, {});
    database = mongoDBConnection.db("users");
}
connectToMongoDB();

app.use(session({
    secret: process.env.NODE_SESSION_SECRET,
    saveUninitialized: false,
    resave: true,
    store: new MongoStore({
        mongoUrl: atlasURI,
        autoRemove: 'native',
        crypto: {
            secret: process.env.MONGODB_SESSION_SECRET
        }
    })
}
));

app.get('/', (req, res) => {
    if(req.session.authenticated) {
        res.render('landingYes', {
            user: { name: req.session.username }
        });
    } else {
        res.render('landingNo');
    }
});

app.get('/signup', (req, res) => {
    res.render('signup', {
        error: { userFound: req.session.loginFailed }
    });
});

app.get('/login', (req, res) => {

    if (req.session.loginFailed == true) {
        delete req.session.loginFailed;
    }

    res.render('login', { 
        error: { name: req.session.loginFailed }
    });
});

app.get('/members', (req, res) => {
    
    let picNumber = (Math.floor(Math.random() * 3) + 1);

    if (!req.session.authenticated) {
        res.redirect('/');
        return;
    } else {
        res.render('members', {
            user: { name: req.session.username }
        });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/admin', async (req, res) => {
    if (!req.session.authenticated) {
        res.redirect('/login');
        return;
    } else {
        let authorized;
        await database.collection('users').findOne({username: req.session.username}).then((user) => {
            if (user.userType == "admin") {
                authorized = true;
            } else {
                authorized = false;
            }
        });

        let users = await database.collection('users').find({}).project({ username: 1, userType: 1, _id: 0 }).toArray((err, result) => {
            if (err) throw err;
            return result;
        });
    
        if (authorized) {
            res.render('admin', {
                userList: users
            });
        } else {
            return res.status(403).render('error', {
                message: "Isufficient permissions."
            });
        }
    }
});

app.post('/signup', async (req, res) => {
    const schema = Joi.object({
        username: Joi.string().alphanum().max(20).required(),
        email: Joi.string().email({ minDomainSegments: 2, tlds: { allow: ['com', 'net']}}),
        password: Joi.string().max(20).required()
    });

    const validData = schema.validate(req.body);

    if (validData.error != null) {
        console.log(validData.error);
        res.redirect('/signup');
        return;
    }

    let notFound = false;

    await database.collection('users').findOne({email: req.body.email}).then((user) => {
        if (!user) {
            notFound = true;
        } else {
            req.session.authenticated = false;
            req.session.loginFailed = 'true';

            return res.redirect('/signup');
        }
    });

    if (notFound) {
        let hashedPassword = await bcrypt.hash(req.body.password, 12);
    
        database.collection('users').insertOne({
            username: req.body.username,
            email: req.body.email,
            password: hashedPassword,
            userType: "user"
        });
    
        req.session.username = req.body.username;
        req.session.authenticated = true;
        req.session.cookie.expires = 3600000;
    
        res.redirect('/members');
    }
});

app.post('/login', async (req, res) => {
    const schema = Joi.object({
        email: Joi.string().email({ minDomainSegments: 2, tlds: { allow: ['com', 'net']}}),
        password: Joi.string().max(20).required()
    });

    const validData = schema.validate(req.body);

    if (validData.error != null) {
        return res.redirect('/login');
        
    }

    let username;
    let password;
    let found = false;

    await database.collection('users').findOne({email: req.body.email}).then((user) => {
        if (!user) {
            req.session.authenticated = false;
            req.session.loginFailed = 'email';
            return res.redirect('/login');
        } else {
            password = user.password;
            username = user.username;
            found = true;
        }
    });
    
    if (found) {
        if (await bcrypt.compare(req.body.password, password)) {
            req.session.authenticated = true;
            req.session.username = username;
            req.session.cookie.expires = 3600000;
            delete req.session.loginFailed;
            return res.redirect('/members');
        } else {
            req.session.authenticated = false;
            req.session.loginFailed = 'password';
            return res.redirect('/login');
        }
    }
});

app.post('/promote/:username', async (req, res) => {
    const schema = Joi.object({
        username: Joi.string().alphanum().max(20).required()
    });

    const validData = schema.validate(req.params);

    if (validData.error != null) {
        return res.redirect('/admin');
    } else {
        let user = req.params.username;        
        let toUpdate = {$set: {userType: "admin"} };

        database.collection('users').updateOne({ username: user }, toUpdate);
        res.redirect('/admin');
    }
});

app.post('/demote/:username', (req, res) => {
    const schema = Joi.object({
        username: Joi.string().alphanum().max(20).required()
    });

    const validData = schema.validate(req.params);

    if (validData.error != null) {
        return res.redirect('/admin');
    } else {
        let user = req.params.username;        
        let toUpdate = {$set: {userType: "user"} };

        database.collection('users').updateOne({ username: user }, toUpdate);
        res.redirect('/admin');
    }
});

app.get('/*splat', (req, res) => {
    res.status(404);
    res.render('notFound', {
        picture: "/images/notFound.jpg"
    });
});

app.listen(port, () => {
    console.log('Running express server');
});