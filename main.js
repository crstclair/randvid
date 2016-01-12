var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var hbs = require('hbs');
var fs = require('fs');
var AWS = require('aws-sdk');

var routes = require('./routes/index');

var app = express();
var cloudwatchlogs = new AWS.CloudWatchLogs({apiVersion: '2014-03-28', region: 'us-east-1'});

// express configuration
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');
app.set('trust proxy', 'loopback');

//load app configuration
var config, configString;
try {
  configString = fs.readFileSync(process.env.CONFIG || 'config.json', {encoding: 'UTF-8'}); //Load configuration file
  config = JSON.parse(configString);
}
catch(ex) {
  console.log("Could not load configuration: " + ex.message);
  console.log("Using defaults");
  config = {};
}

//configuration defaults
config.domain = config.domain || "example.com";
config.analytics = config.analytics || "<!--No analytics set in configuration-->";
config.addthisID = config.addthisID || "Addthis pubID not set";

var analyticsString = app.get('env') === 'development' ? '<!--No analytics for dev environment-->' : config.analytics;
hbs.registerHelper('analytics', function() {
  return analyticsString;
});

// uncomment after placing your favicon in /public
//app.use(favicon(__dirname + '/public/favicon.ico'));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

//set configuration for every request
app.use(function(req, res, next) {
  req.config = config;
  return next();
});

app.use('/', routes);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.render('error', {
    message: err.message
  });

  //error logging
  var dateNow = new Date();
  var cloudwatchStreamName = "randvid/" + dateNow.getUTCFullYear() + "/" + (dateNow.getUTCMonth() + 1) + "/" + dateNow.getUTCDate() + "/" + Math.floor(Math.random() * 1000000000000);
  var errInfo = {
    time: Date.now(),
    status: err.status,
    message: err.message,
    stack: err.stack
  };
  cloudwatchlogs.createLogStream({
    logGroupName: '/aws/test', //TODO: use better group name
    logStreamName: cloudwatchStreamName
  }, function (err2, data) {
    if(err2) {return console.error(err2);}
    console.log("Created stream " + cloudwatchStreamName);
    console.log(data);
    cloudwatchlogs.putLogEvents({
      logEvents: [
        {
          message: JSON.stringify(errInfo),
          timestamp: Date.now()
        }
      ],
      logGroupName: '/aws/test',
      logStreamName: cloudwatchStreamName
    }, function(err2, data) {
      if(err2) {return console.error(JSON.stringify(err2));}
      console.log(JSON.stringify(data));
    });
  });
});


module.exports = app;
