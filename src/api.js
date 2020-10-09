const redis = require('../lib/redis.js')
const { promisify } = require('util')

async function _execRedisAsync (cmd, ...params) {
  const commandAsync = promisify(redis[cmd]).bind(redis)
  return commandAsync(...params)
}

// Get Hour Number from timestamp e.g 2018-07-19T23:28:59.513Z => 23
function getHours (timestamp) {
  const result = timestamp.match(/\d\d:\d\d/)
  const hours = result[0].split(':')
  return hours[0]
}

// Get All targets stored in redis.
async function getAllTargets () {
  const AllKeys = await _execRedisAsync('keys', 'target:*')
  const promises = []
  for (const i in AllKeys) {
    promises.push(JSON.parse(await _execRedisAsync('get', AllKeys[i])))
  }
  var allTargets = await Promise.all(promises)
  return allTargets
}

/* This function is responsible for handling
and sorting of targets according to visitor data.
*/
async function filterByLimitAndHours (data, targets) {
  data.hour = getHours(data.timestamp)
  const promises = []
  for (const i in targets) {
    promises.push(checkTarget(data, targets[i]))
  }
  let filtered = await Promise.all(promises)
  filtered = filtered.filter(x => x !== null)
  filtered.sort(function (a, b) {
    const keyA = a.value
    const keyB = b.value
    if (keyA < keyB) return 1
    if (keyA > keyB) return -1
  })
  return filtered
}

/* All the condtitions will be checked here.
Conditions Applied here.
1- If visit state is acceptable.
2- If the timestamp of visitor is acceptable.
3- If date is not of today in limit record
then select the target without any prior checking.
4- Check if max limit hit or not.
*/
async function checkTarget (data, target) {
  if (target.accept.geoState.$in.includes(data.geoState) !== true) {
    return null
  }
  if (target.accept.hour.$in.includes(data.hour) !== true) {
    return null
  }
  let result = await _execRedisAsync('get', 'LimitRecord:' + target.id + ':' + data.publisher)
  result = JSON.parse(result)
  const datetime = new Date()
  const date = datetime.toISOString().slice(0, 10)
  if (result.date !== date) {
    return target
  } else {
    if (result.hit > target.maxAcceptsPerDay) {
      return null
    } else {
      return target
    }
  }
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
  const serializeTarget = JSON.stringify(target)
  await _execRedisAsync('set', 'target:' + target.id, serializeTarget)
  return {
    code: 200,
    result: {
      status: 'OK'
    }
  }
}

// api/target/:id -GET
const getTargetByIdHandle = async (id) => {
  return {
    code: 200,
    result: await _execRedisAsync('get', 'target:' + id)
  }
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
    const selectedTarget = filteredTargets[0]
    const datetime = new Date()
    const date = datetime.toISOString().slice(0, 10)
    let result = await _execRedisAsync('get', 'LimitRecord:' + selectedTarget.id + ':' + body.publisher)
    if (result == null) {
      var insertRecord = { hit: 1, date: date }
      insertRecord = JSON.stringify(insertRecord)
      await _execRedisAsync('set', 'LimitRecord:' + selectedTarget.id + ':' + body.publisher, insertRecord)
    } else {
      result = JSON.parse(result)
      var updateRecord = { hit: result.hit + 1, date: date }
      updateRecord = JSON.stringify(updateRecord)
      await _execRedisAsync('set', 'LimitRecord:' + selectedTarget.id + ':' + body.publisher, updateRecord)
      return {
        code: 200,
        result: {
          status: 'OK',
          url: selectedTarget.url
        }
      }
    }
  }
}

module.exports = {
  getTargetsHandle,
  getTargetByIdHandle,
  addOrUpdateTargetHandle,
  filterHandle
}
