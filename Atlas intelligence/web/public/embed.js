/* Atlas Infinity embed · drop-in for the City Atlas app (or any page).
 *
 *   <script src="https://YOUR-ATLAS-HOST/embed.js"></script>
 *   <div id="atlas" style="height:600px"></div>
 *   <script>
 *     const atlas = AtlasInfinity.mount('#atlas', { lng: 77.2167, lat: 28.6315, zoom: 16.5, mode: 'mobility', lang: 'hi', theme: 'day' })
 *     atlas.on('answer', a => console.log(a.text, a.facts))
 *     atlas.ask('Why is traffic slow?')
 *     atlas.setView(77.2295, 28.6129, 17)
 *   </script>
 *
 * No build step, no framework. The iframe talks to the host with postMessage; see docs/INTEGRATION.md.
 */
(function (global) {
  'use strict'
  var HOST = (function () {
    var s = document.currentScript && document.currentScript.src
    if (!s) return ''
    try { var u = new URL(s); return u.origin + u.pathname.replace(/\/embed\.js$/, '') } catch (e) { return '' }
  })()

  function mount(target, opts) {
    opts = opts || {}
    var el = typeof target === 'string' ? document.querySelector(target) : target
    if (!el) throw new Error('AtlasInfinity.mount: target not found')
    var base = opts.host || HOST || ''
    var q = new URLSearchParams()
    q.set('embed', '1')
    if (opts.region) q.set('region', opts.region)
    if (opts.lng != null && opts.lat != null) { q.set('lng', String(opts.lng)); q.set('lat', String(opts.lat)) }
    if (opts.zoom != null) q.set('zoom', String(opts.zoom))
    if (opts.mode) q.set('mode', opts.mode)
    if (opts.lang) q.set('lang', opts.lang)
    if (opts.theme) q.set('theme', opts.theme)
    var iframe = document.createElement('iframe')
    iframe.src = base + '/?' + q.toString()
    iframe.allow = 'camera; microphone; geolocation'
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;background:' + (opts.theme === 'night' ? '#071924' : '#fbfaf6') + ';border-radius:' + (opts.radius || '0')
    iframe.title = 'Atlas Infinity'
    el.appendChild(iframe)

    var listeners = {}
    var ready = false, queue = []
    function send(msg) { if (!ready) { queue.push(msg); return } iframe.contentWindow.postMessage(msg, '*') }
    function emit(type, data) { (listeners[type] || []).forEach(function (fn) { try { fn(data) } catch (e) { console.error(e) } }) }
    function onMessage(e) {
      if (e.source !== iframe.contentWindow) return
      var m = e.data
      if (!m || typeof m.type !== 'string' || m.type.indexOf('atlas:') !== 0) return
      var type = m.type.slice(6)
      if (type === 'ready') { ready = true; queue.splice(0).forEach(function (x) { iframe.contentWindow.postMessage(x, '*') }) }
      emit(type, m)
      emit('*', m)
    }
    window.addEventListener('message', onMessage)

    return {
      iframe: iframe,
      on: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); return this },
      off: function (type, fn) { listeners[type] = (listeners[type] || []).filter(function (f) { return f !== fn }); return this },
      setView: function (lng, lat, zoom) { send({ type: 'atlas:setView', lng: lng, lat: lat, zoom: zoom }); return this },
      setMode: function (mode) { send({ type: 'atlas:setMode', mode: mode }); return this },
      setLanguage: function (lang) { send({ type: 'atlas:setLanguage', lang: lang }); return this },
      setTheme: function (theme) { send({ type: 'atlas:setTheme', theme: theme }); return this },
      ask: function (question) { send({ type: 'atlas:ask', question: question }); return this },
      zone: function (name, ring) { send({ type: 'atlas:zone', name: name, ring: ring }); return this },
      snapshot: function () { send({ type: 'atlas:snapshot' }); return this },
      destroy: function () { window.removeEventListener('message', onMessage); iframe.remove() }
    }
  }

  global.AtlasInfinity = { mount: mount, version: '1.0.0' }
})(window)
