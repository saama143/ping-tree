const redis = require('../lib/redis.js')

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

// api/targets -GET
const getTargetsHandle = async () => {
  var targets = await getAllTargets()
  return {
    code: 200,
    status: 'OK',
    result: targets
  }
}

// api/targets -POST
const addOrUpdateTargetHandle = async (target) => {
  var serializeTarget = JSON.stringify(target)
  try {
    redis.set('target:' + target.id, serializeTarget)
    return {
      code: 200,
      result: {
        status: 'OK'
      }
    }
  } catch (e) {
    return {
      code: 503,
      result: {
        status: 'Fail',
        error: 'Something Went Wrong. While modifying target.'
      }
    }
  }
}

// api/target/:id -GET
const getTargetByIdHandle = async (id) => {
  return new Promise((resolve, reject) => {
    redis.get('target:' + id, function (err, target) {
      if (err) {
        resolve({
          code: 503,
          result: {
            code: 503,
            status: 'Fail',
            error: 'Not able to get record'
          }
        })
      } else {
        resolve({
          code: 200,
          status: 'OK',
          result: target
        })
      }
    })
  })
}

// route -POST
const filterHandle = async (body) => {
  var allTargets = await getAllTargets()
  var filteredTargets = await filterByLimitAndHours(body, allTargets)
  if (filteredTargets.length === 0) {
    return {
      code: 503,
      result: {
        status: 'fail',
        error: 'reject',
        decision: 'reject'
      }
    }
  } else {
    var selectedTarget = filteredTargets[0]
    var datetime = new Date()
    var date = datetime.toISOString().slice(0, 10)
    return new Promise((resolve, reject) => {
      redis.get('LimitRecord:' + selectedTarget.id + ':' + body.publisher, async function (err, result) {
        if (err) {
          resolve({
            code: 503,
            result: {
              status: 'fail',
              error: 'Not Able to get limit record'
            }
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
          resolve({
            code: 200,
            result: {
              status: 'OK',
              url: selectedTarget.url
            }
          })
        }
      })
    })
  }
}

module.exports = {
  getTargetsHandle,
  getTargetByIdHandle,
  addOrUpdateTargetHandle,
  filterHandle
}
