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

    t.is(res.body.status, 'OK', 'status is ok')
    t.is(res.statusCode, 200, 'correct statusCode')
    t.end()
  })
})

test.serial.cb('Get Target By Id', function (t) {
  var url = '/api/target/1'
  servertest(server(), url, { encoding: 'json' }, function (err, res) {
    t.falsy(err, 'no error')

    t.is(res.body.status, 'OK', 'status is ok')
    t.is(res.statusCode, 200, 'correct statusCode')
    t.end()
  })
})
