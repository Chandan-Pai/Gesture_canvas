/** Suppress MediaPipe WASM glog lines Chrome surfaces as extension "errors". */
(function installMediaPipeLogFilter() {
  if (window.__gcMediaPipeLogFilter) return;
  window.__gcMediaPipeLogFilter = true;

  const GLOG_LINE = /^[IWEF]\d{4}\s+\d{2}:\d{2}:\d+/;

  ['log', 'warn', 'error'].forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      const first = args[0];
      if (typeof first === 'string' && (GLOG_LINE.test(first) || first.includes('gl_context'))) {
        return;
      }
      original(...args);
    };
  });
})();
