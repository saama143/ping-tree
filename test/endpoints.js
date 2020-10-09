process.env.NODE_ENV = 'test'

var test = require('ava')
var servertest = require('servertest')

var server = require('../lib/server')

test.serial.cb('healthcheck', function (t) {
  var url = '/health'
  servertest(server(), url, { encoding: 'json' }, function (err, res) {
    t.falsy(err, 'no error')

    t.is(res.statusCode, 200, 'correct statusCode')
    t.is(res.body.status, 'OK', 'status is ok')
    t.end()
  })
})

test.serial.cb('Get All Targets', function (t) {
  var url = '/api/targets'
  servertest(server(), url, { encoding: 'json' }, function (err, res) {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 200, 'correct statusCode')
    t.end()
  })
})

test.serial.cb('Get Target By Id', function (t) {
  var url = '/api/target/1'
  servertest(server(), url, { encoding: 'json' }, function (err, res) {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 200, 'correct statusCode')
    t.end()
  })
})

const streamTest = (stream, obj) => {
  stream.write(JSON.stringify(obj))
  stream.end()
}

test.serial.cb('/route', (t) => {
  const visitor = {
    geoState: 'uk',
    publisher: 'abc',
    timestamp: '2018-07-19T23:28:59.513Z'
  }

  streamTest(servertest(server(), '/route', { method: 'POST' }, (err, res) => {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 503)
    t.end()
  }), visitor)
})

test.serial.cb('POST /api/targets', t => {
  const data = {
    id: '1',
    url: 'http://example.com',
    value: '0.50',
    maxAcceptsPerDay: '10',
    accept: {
      geoState: {
        $in: ['ca', 'ny']
      },
      hour: {
        $in: ['13', '14', '15']
      }
    }
  }
  const url = '/api/targets'
  streamTest(servertest(server(), url, { method: 'POST' }, (err, res) => {
    const response = JSON.parse(res.body.toString())
    t.falsy(err, 'no error')
    t.deepEqual(response, {
      status: 'OK'
    })
    t.is(res.statusCode, 200, 'correct statusCode')
    t.end()
  }), data)
})
