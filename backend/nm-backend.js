/* Namak Mandi back end client (Supabase). Shared by the website and the admin page.
   Needs backend/config.js (your project URL and public "anon" key) and backend/vendor/supabase.js loaded first.
   If config.js is empty, window.NMB.enabled is false and the website keeps working exactly as before. */
(function () {
  "use strict";
  var cfg = window.NM_BACKEND || {};
  var B = (window.NMB = { enabled: false });
  if (!cfg.url || !cfg.anonKey || !window.supabase || !window.supabase.createClient) return;
  B.enabled = true;
  B.cfg = cfg;
  B.client = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "nm-auth" }
  });

  B.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  };
  B.money = function (n) { return "£" + Number(n || 0).toFixed(2); };

  // Turn a Supabase error into text a guest can read. Our own rules (code P0001) carry a friendly message.
  function nice(e) {
    if (!e) return "Something went wrong. Please try again or call us.";
    if (e.code === "P0001") return e.message;
    if (e.code === "42501") return "You do not have permission to do that.";
    if (/Failed to fetch|NetworkError|Load failed/i.test(e.message || "")) return "Could not reach the server. Please check your connection and try again.";
    if (window.console) console.warn("NMB error", e);
    return e.message || "Something went wrong. Please try again or call us.";
  }
  B.nice = nice;
  B.fail = function (e) { var err = new Error(nice(e)); err.raw = e; return err; };

  B.rpc = function (name, args) {
    return B.client.rpc(name, args || {}).then(function (r) { if (r.error) throw B.fail(r.error); return r.data; });
  };
  // run a query builder and unwrap { data, error }
  B.q = function (builder) {
    return Promise.resolve(builder).then(function (r) { if (r.error) throw B.fail(r.error); return r.data; });
  };

  B.user = null; B.profile = null; B.role = null;
  var subs = [];
  B.onChange = function (fn) { subs.push(fn); };
  function emit() { subs.forEach(function (f) { try { f(B); } catch (e) { if (window.console) console.error(e); } }); }

  B.loadMe = function () {
    return B.client.auth.getSession().then(function (r) {
      var s = r.data && r.data.session;
      B.user = s ? s.user : null;
      if (!B.user) { B.profile = null; B.role = null; return null; }
      return Promise.all([
        B.client.from("profiles").select("*").eq("id", B.user.id).maybeSingle(),
        B.client.rpc("my_role")
      ]).then(function (x) {
        B.profile = (x[0] && x[0].data) || null;
        B.role = (x[1] && x[1].data) || null;
        return B.profile;
      });
    });
  };
  B.refreshMe = function () { return B.loadMe().then(emit); };

  B.client.auth.onAuthStateChange(function (event) {
    if (event === "PASSWORD_RECOVERY") B.recovery = true;
    // do not call supabase inside the callback itself (can dead-lock); defer
    setTimeout(function () { B.loadMe().then(function () { emit(); }); }, 0);
  });
  B.ready = B.loadMe().then(emit);
})();
