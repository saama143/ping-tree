var URL = require('url')
var http = require('http')
var cuid = require('cuid')
var Corsify = require('corsify')
var sendJson = require('send-data/json')
var ReqLogger = require('req-logger')
var healthPoint = require('healthpoint')
var HttpHashRouter = require('http-hash-router')

var redis = require('./redis')
var version = require('../package.json').version

var router = HttpHashRouter()
var logger = ReqLogger({ version: version })
var health = healthPoint({ version: version }, redis.healthCheck)
var cors = Corsify({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, accept, content-type'
})

router.set('/favicon.ico', empty)

module.exports = function createServer () {
  return http.createServer(cors(handler))
}

function handler (req, res) {
  if (req.url === '/health') return health(req, res)
  req.id = cuid()
  logger(req, res, { requestId: req.id }, function (info) {
    info.authEmail = (req.auth || {}).email
    // console.log(info)
  })
  router(req, res, { query: getQuery(req.url) }, onError.bind(null, req, res))
}

function onError (req, res, err) {
  if (!err) return

  res.statusCode = err.statusCode || 500
  logError(req, res, err)

  sendJson(req, res, {
    error: err.message || http.STATUS_CODES[res.statusCode]
  })
}

function logError (req, res, err) {
  if (process.env.NODE_ENV === 'test') return

  var logType = res.statusCode >= 500 ? 'error' : 'warn'

  console[logType]({
    err: err,
    requestId: req.id,
    statusCode: res.statusCode
  }, err.message)
}

function empty (req, res) {
  res.writeHead(204)
  res.end()
}

function getQuery (url) {
  return URL.parse(url, true).query // eslint-disable-line
}

// Get Hour Number from timestamp e.g 2018-07-19T23:28:59.513Z => 23
function getHours (timestamp) {
  const result = timestamp.match(/\d\d:\d\d/)
  const hours = result[0].split(':')
  return hours[0]
}

// Get All targets stored in redis.
function getAllTargets () {
  return new Promise((resolve, reject) => {
    redis.keys('target:*', async function (err, AllKeys) {
      if (err) {
        console.log(err)
      } else {
        var promises = []
        for (var i in AllKeys) {
          promises.push(getTargetByKey(AllKeys[i]))
        }

        try {
          var allTargets = await Promise.all(promises)
          resolve(allTargets)
        } catch (e) {
          console.log(e)
          reject(new Error('Not able to fetch all errors.'))
        }
      }
    })
  })
}

// Get target by key (redis Key)
function getTargetByKey (key) {
  return new Promise(function (resolve, reject) {
    redis.get(key, function (err, result) {
      if (err) {
        reject(new Error('Not Able to Fetch Target By Key'))
      } else {
        resolve(JSON.parse(result))
      }
    })
  })
}

/* This function is responsible for handling
and sorting of targets according to visitor data.
*/
async function filterByLimitAndHours (data, targets) {
  data.hour = getHours(data.timestamp)
  var promises = []
  for (var i in targets) {
    promises.push(checkTarget(data, targets[i]))
  }

  try {
    var filtered = await Promise.all(promises)
    filtered = filtered.filter(x => x !== null)
    filtered.sort(function (a, b) {
      var keyA = a.value
      var keyB = b.value
      if (keyA < keyB) return 1
      if (keyA > keyB) return -1
    })
    return filtered
  } catch (e) {
    console.log(e)
  }
}

/* All the condtitions will be checked here.
Conditions Applied here.
1- If visit state is acceptable.
2- If the timestamp of visitor is acceptable.
3- If date is not of today in limit record
then select the target without any prior checking.
4- Check if max limit hit or not.
*/
function checkTarget (data, target) {
  return new Promise(function (resolve, reject) {
    if (target.accept.geoState.$in.includes(data.geoState) !== true) {
      resolve(null)
    }

    if (target.accept.hour.$in.includes(data.hour) !== true) {
      resolve(null)
    }
    redis.get('LimitRecord:' + target.id + ':' + data.publisher, async function (err, result) {
      if (err) {
        reject(new Error('Not Able to Fetch Limit Record.'))
      } else {
        if (result == null) {
          resolve(target)
        } else {
          result = JSON.parse(result)
          var datetime = new Date()
          var date = datetime.toISOString().slice(0, 10)
          if (result.date !== date) {
            resolve(target)
          } else {
            if (result.hit > target.maxAcceptsPerDay) {
              resolve(null)
            } else {
              resolve(target)
            }
          }
        }
      }
    })
  })
}

// Get And Update Targets
router.set('/api/targets', async function targets (req, res) {
  if (req.method === 'POST') { // Get Targets
    var body = ''
    req.on('data', function (data) {
      body += data.toString()
      if (body.length > 1e6) { req.connection.destroy() }
    })
    req.on('end', function () {
      if (body === '') {
        sendJson(req, res, {
          error: 'Missing Body'
        })
      } else {
        body = JSON.parse(body)
        var rawBody = JSON.stringify(body)
        try {
          redis.set('target:' + body.id, rawBody)
          sendJson(req, res, {
            success: 'Target Added or updated successfully.'
          })
        } catch (e) {
          sendJson(req, res, {
            error: e
          })
        }
      }
    })
  } else { // Update Target
    var allTargets = await getAllTargets()
    sendJson(req, res, {
      targets: allTargets,
      status: 'OK'
    })
  }
})

// Get Target By Id.
router.set('/api/target/:id', function targets (req, res) {
  var id = URL.parse(req.url, true).path.replace('/api/target/', '') // eslint-disable-line
  redis.get('target:' + id, function (err, target) {
    if (err) {
      sendJson(req, res, {
        error: 'Not able to get target'
      })
    } else {
      sendJson(req, res, {
        target: JSON.parse(target),
        status: 'OK'
      })
    }
  })
})

// Get Target Url as per visitor information.
router.set('/route', function targets (req, res) {
  if (req.method === 'POST') { // Only posted data in json format is allowed.
    var body = ''
    req.on('data', function (data) {
      body += data.toString()
      if (body.length > 1e6) { req.connection.destroy() }
    })
    req.on('end', async function () {
      if (body === '') {
        sendJson(req, res, {
          error: 'Missing Body'
        })
      } else {
        body = JSON.parse(body)
        var allTargets = await getAllTargets()
        var filteredTargets = await filterByLimitAndHours(body, allTargets)
        if (filteredTargets.length === 0) {
          sendJson(req, res, {
            error: 'Reject',
            decision: 'reject'
          })
        } else {
          var selectedTarget = filteredTargets[0]
          var datetime = new Date()
          var date = datetime.toISOString().slice(0, 10)

          redis.get('LimitRecord:' + selectedTarget.id + ':' + body.publisher, async function (err, result) {
            if (err) {
              sendJson(req, res, {
                error: 'Not Able to get record'
              })
            } else {
              if (result == null) {
                var insertRecord = {
                  hit: 1,
                  date: date
                }
                insertRecord = JSON.stringify(insertRecord)
                redis.set('LimitRecord:' + selectedTarget.id + ':' + body.publisher, insertRecord)
              } else {
                result = JSON.parse(result)
                var updateRecord = {
                  hit: result.hit + 1,
                  date: date
                }
                updateRecord = JSON.stringify(updateRecord)
                redis.set('LimitRecord:' + selectedTarget.id + ':' + body.publisher, updateRecord)
              }
              sendJson(req, res, {
                remainingTarget: selectedTarget.url
              })
            }
          })
        }
      }
    })
  } else { // Get request on this route is not allowed.
    res.end('Now Allowed.')
  }
})
