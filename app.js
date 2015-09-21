/* ===============================================================================
 * Name: app.js
 * Project: funnelope.fetcher
 * Date: 09/18/2015
 * 
 * Description: Runs on a schedule, and syncs the list of games in funnelope DB
 * =============================================================================*/
var Q = require('q');
var Fireproof = require('fireproof');
Fireproof.bless(Q);

var Firebase = require('firebase');

var _ = require('underscore');
var parseXML = require('xml2js').parseString;

var RateLimiter = require('limiter').RateLimiter;
var limiter = new RateLimiter(1, 250);
var gameDB = require('./libs/thegamedb');
var config = require('./libs/config');
var platforms = [];

function removeColon(name) {
    return name.replace(':', '_');
}

var popularSystemShortNames = {
    microsoft_xbox_one : ['xboxOne'],
    microsoft_xbox : ['xbox'],
    microsoft_xbox_360: ['xbox360', '360'],
    nintendo_3ds: ['3ds'],
    nintendo_64: ['n64', '64'],
    nintendo_ds: ['ds'],
    nintendo_entertainment_system_nes : ['nes'],
    nintendo_wii : ['wii'],
    nintendo_wii_u : ['wiiu'],
    sony_playstation_4 : ['ps4'],
    sony_playstation_3 : ['ps3'],
    sony_playstation_2 : ['ps2'],
    sony_playstation : ['ps', 'ps1'],
    sony_playstation_vita : ['psvita', 'vita'],
    sony_psp : ['psp']
}

var lastpositionacquired = false;

gameDB.getGamesPlatformList().then(function (data) {

    var options = {
        tagNameProcessors: [removeColon],
        ignoreAttrs : false
    }
    
    parseXML(data, options, function (err, parsedResult) {
        var gamesTitles = '';
        
        if (parsedResult.Data !== null && parsedResult.Data !== undefined && parsedResult.Data.Platforms !== null && parsedResult.Data.Platforms !== undefined && parsedResult.Data.Platforms.length > 0) {
            _.each(parsedResult.Data.Platforms, function (platformArray) {
                if (platformArray !== null && platformArray !== undefined && platformArray.Platform !== null && platformArray.Platform !== undefined && platformArray.Platform.length > 0) {
                    _.each(platformArray.Platform, function (platformItems) {
                        var aliasArray = platformItems.alias;
                        var idArray = platformItems.id;
                        var nameArray = platformItems.name;

                        //Get the platforms into our own array
                        var platform = {};

                        platform.alias = aliasArray !== null && aliasArray !== undefined && aliasArray.length > 0 ? aliasArray[0] : '';
                        platform.id = idArray !== null && idArray !== undefined && idArray.length > 0 ? idArray[0] : '';
                        platform.name = nameArray !== null && nameArray !== undefined && nameArray.length > 0 ? nameArray[0] : '';
                        
                        //check to see if we stopped at the current platform when retrieving the list of games
                        var lastStoppedRef = new Firebase(config.firebase.url + config.firebase.endpoints.laststopped);
                        var lastStoppedProof = new Fireproof(lastStoppedRef);
                        
                        lastStoppedProof.once('value', function (laststoppedSnap) {
                            var laststopped = laststoppedSnap.val();

                            if (lastpositionacquired === true || laststoppedSnap == null || laststoppedSnap == undefined || (laststoppedSnap !== null && laststoppedSnap !== undefined && laststoppedSnap.platformid === platform.id)) {
                                //Mark that we have acquired our last position
                                lastpositionacquired = true;

                                var newlastStoppedRef = new Firebase(config.firebase.url + config.firebase.endpoints.laststopped);
                                var newlastStoppedProof = new Fireproof(newlastStoppedRef);
                                newlastStoppedProof.set({ platformid: platform.id });

                                //continue with retrieval
                                var delayedFunction = function () {
                                    gameDB.getGamesByPlatform(platform.id).then(function (gamesData) {
                                        
                                        var childOptions = {
                                            tagNameProcessors: [removeColon],
                                            ignoreAttrs : false
                                        }
                                        
                                        parseXML(gamesData, childOptions, function (err, parsedGameResult) {
                                            if (parsedGameResult.Data !== null && parsedGameResult.Data !== undefined && parsedGameResult.Data.Game !== null && parsedGameResult.Data.Game !== undefined && parsedGameResult.Data.Game.length > 0) {
                                                
                                                _.each(parsedGameResult.Data.Game, function (gameArray, gameArrayIndex) {
                                                    var gameTitle = gameArray.GameTitle !== null && gameArray.GameTitle !== undefined && gameArray.GameTitle.length > 0 ? gameArray.GameTitle[0] : null;
                                                    var id = gameArray.id !== null && gameArray.id !== undefined && gameArray.id.length > 0 ? gameArray.id[0] : null;
                                                    
                                                    //Check firebase for our game (by gamedbid) make sure it doesnt exist already
                                                    if (gameTitle !== null && gameTitle !== undefined && gameTitle !== '' && id !== null && id !== undefined && id !== '') {
                                                        
                                                        //Temporary - If we are using firebase
                                                        if (config.useFirebase) {
                                                            var gamesRefs = new Firebase(config.firebase.url + config.firebase.endpoints.games);
                                                            var gamesProof = new Fireproof(gamesRefs);
                                                            
                                                            gamesProof
                                                            .orderByChild('gamedbid')
                                                            .equalTo(id)
                                                            .once('value')
                                                            .then(function (snapshot) {
                                                                var result = snapshot.val();
                                                                if (result) {
                                                                    //check to see if it has search indexes. if it doesn't, add indexes for it
                                                                    if (!result.systemgameindex) {
                                                                        //save the system game index
                                                                        var gameRef = new Firebase(config.firebase.url + config.firebase.endpoints.games + '/' + snapshot.key() + '/systemgameindex');
                                                                        var systemgameindex = result.gamedbsystemalias + result.title;
                                                                        gameRef.set(systemgameindex);
                                                                        console.log('Updated game: ' + result.title + ' | system: ' + result.gamedbsystemname);
                                                                    }
                                                                }
                                                                else {
                                                                    //Save this record for it's system/platform 
                                                                    var newGame = {
                                                                        gamedbid: id,
                                                                        title: gameTitle,
                                                                        gamedbsystemid : platform.id,
                                                                        gamedbsystemalias : platform.alias,
                                                                        gamedbsystemname: platform.name,
                                                                        systemgameindex: platform.alias + gameTitle
                                                                    }
                                                                    
                                                                    var newGamesRef = new Firebase(config.firebase.url + config.firebase.endpoints.games);
                                                                    var newGamesProof = new Fireproof(newGamesRef);
                                                                    
                                                                    newGamesProof.push(newGame);
                                                                    console.log('saved game: ' + gameTitle + ' | system: ' + platform.name);
                                                                    
                                                                    if ((platforms.length - 1) === platformindex && (gameArrayIndex.length - 1) === gameArrayIndex) {
                                                                        var removelastStoppedRef = new Firebase(config.firebase.url + config.firebase.endpoints.laststopped);
                                                                        var removelastStoppedProof = new Fireproof(removelastStoppedRef);
                                                                        removelastStoppedProof.remove();

                                                                        console.log('--------------------fetcher has finished---------------------');
                                                                    }
                                                                }
                                                            });
                                                        }
                                                    }
                                                })
                                            }
                                        });
                                    });
                                }

                                limiter.removeTokens(1, function () {
                                    delayedFunction();
                                });
                            }
                        });
                    })
                }
            });
        }
    });
});