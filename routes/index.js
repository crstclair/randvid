var express = require('express');
var AWS = require('aws-sdk');
var router = express.Router();
var dynamodb = new AWS.DynamoDB({apiVersion: '2012-08-10', region: 'us-east-1'});
var LRU = require("lru-cache");

var cache = LRU( {max: 100000, length: function(n){return n.length}});
var developmentEnvironment = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
var dynamoTable = developmentEnvironment ? 'dev.randvid.videosets' : 'randvid.videosets';

function randString(length) {
  var characters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  var res = "";

  for(var i = 0; i < length; ++i) {
    res += characters.charAt(Math.floor(Math.random() * characters.length));
  }

  return res;
}

function parseTime(timeString) {
  if(timeString.length === 0) {return 0;}

  var matches = timeString.match(/(\d+):(\d\d)/);
  if(!matches) return null;

  return parseInt(matches[1]) * 60 + parseInt(matches[2]);
}

var findVideoID = function(url) {
  var id = url.match(/youtube.+[&?]v=([A-Za-z0-9_-]{11})/)
      || url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) //URL from YT link shortener
      || url.match(/youtube.+%3Fv%3D([A-Za-z0-9_-]{11})/); //URL from share widget
  if(id) return id[1];

  return null;
};

//second parameter of callback is sent directly to the renderer.
var getVideoInfo = function(setID, opt, callback) {
  var options = {
    'a': {videoAttributeName: 'VidA', timeAttributeName: 'TimeA', alt: 'b'},
    'b': {videoAttributeName: 'VidB', timeAttributeName: 'TimeB', alt: 'a'}
  };
  var vidAttr = options[opt].videoAttributeName;
  var timeAttr = options[opt].timeAttributeName;
  var alt = options[opt].alt;

  if(!vidAttr) {
    return process.nextTick(function(){
      callback(new Error("invalid opt"));
    });
  }

  //check cache
  var cachedDataRaw = cache.get(setID);
  if(cachedDataRaw)
  {
    return process.nextTick(function(){
      var cachedData = JSON.parse(cachedDataRaw);
      var item = {
        title: cachedData.Title.S,
        vidID: cachedData[vidAttr].S,
        vidSet: setID,
        alt: alt
      };

      if(cachedData[timeAttr]) { item.startTime = cachedData[timeAttr].N; }

      callback(null, item);
    });
  }

  //not in cache
  dynamodb.getItem({
    TableName: dynamoTable,
    ProjectionExpression : "Title, VidA, TimeA, VidB, TimeB",
    Key: {
      VideoSetID: {
        S: setID
      }
    }
  }, function(err, data) {
    var item;

    if(err) {return callback(err);}
    if(!data.Item) {return callback(null, null);}

    //add to cache
    cache.set(setID, JSON.stringify(data.Item));

    item = {
      title: data.Item.Title.S,
      vidID: data.Item[vidAttr].S,
      vidSet: setID,
      alt: alt
    };

    if(data.Item[timeAttr]) { item.startTime = data.Item[timeAttr].N; }

    return callback(null, item);
  });
};

/*


 And now, the actual routes


 */

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', {
    title: 'Fiftyfifty Videos'
  });
});

router.post('/', function(req, res, next) {
  var errors = [];
  var title = req.body.title;
  var id1 = findVideoID(req.body.vida);
  var id2 = findVideoID(req.body.vidb);
  var time1 = parseTime(req.body.timea);
  var time2 = parseTime(req.body.timeb);

  if(!id1 || !id2) {errors.push("Invalid YouTube URL.");}
  if(time1 === null || time2 === null) {errors.push("Invalid time.");}
  if(id1 === id2) {errors.push("URLs lead to the same video.");}
  if(!title) {errors.push("Title is required.");}
  else if(title.length > 60) {errors.push("Title is too long.");}

  if(errors.length > 0)
  {
    //Validation error. Reject and tell the user.
    res.render('index', {
      title: 'Video Randomizer',
      errors: errors,
      vida: req.body.vida,
      vidb: req.body.vidb,
      timea: req.body.timea,
      timeb: req.body.timeb,
      vidstitle: req.body.title
    });
  }
  else {
    var setID = randString(6);
    var item = {
      VideoSetID: { S: setID },
      VidA: { S: id1 },
      VidB: { S: id2 },
      Title: { S: title },
      IPAddress: { S: req.ip },
      DateAdded: { N: Date.now().toString() }
    };

    if(time1) {
      item.TimeA = { N: time1.toString() };
    }

    if(time2) {
      item.TimeB = { N: time2.toString() };
    }

    item.IPAddress = { S: req.ip };
    item.DateAdded = { N: Date.now().toString() };

    dynamodb.putItem({
      Item: item,
      TableName: dynamoTable,
      // Someday we should retry with a new setID if we picked one that already existed.
      // This won't be a problem till the database gets really big, though.
      // For now we'll just throw an error.
      ConditionExpression: 'attribute_not_exists(VideoSetID)'
    }, function(err, data) {
      if(err) {return next(err);}

      //add to cache
      var cachableItem = {
        VidA: item.VidA,
        VidB: item.VidB,
        Title: item.Title,
        TimeA: item.TimeA,
        TimeB: item.TimeB
      };
      cache.set(setID, JSON.stringify(cachableItem));

      res.render('accepted', {
        title: "Videos Accepted",
        setTitle: title,
        vidSet: setID
      });

    });
  }
});

//specific video requested
router.get('/~:vidID/:opt', function(req, res, next) {
  getVideoInfo(req.params.vidID, req.params.opt, function(err, info) {
    if(err) {return next(err);}
    if(!info) {return next();} //setID not found

    res.render('video', info);
  });
});

//random video requested
router.get('/~:vidID', function(req, res, next) {
  var opt = (Math.floor(Math.random() * 2)) === 0? 'a' : 'b'; //randomly select either a or b

  getVideoInfo(req.params.vidID, opt, function(err, info) {
    if(err) {return next(err);}
    if(!info) {return next();} //setID not found

    res.render('video', info);
  });
});

module.exports = router;
