/* Namak Mandi admin dashboard. Everything here is protected by database rules (Row Level Security),
   not by this page: someone who is not an admin gets nothing back from the database. */
(function () {
  "use strict";
  var app = document.getElementById("app"), B = window.NMB;
  if (!B || !B.enabled) { app.innerHTML = '<div class="login"><h2>Back end not set up</h2><p>Fill in <code>backend/config.js</code> with your Supabase URL and anon key (see README).</p></div>'; return; }
  var esc = B.esc, money = B.money, db = B.client;
  function $(id) { return document.getElementById(id); }
  function today() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function toast(m, bad) { var t = document.createElement("div"); t.className = "toast" + (bad ? " bad" : ""); t.textContent = m; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3200); }
  function run(p, okMsg) { return p.then(function (r) { if (r && r.error) throw B.fail(r.error); if (okMsg) toast(okMsg); return r && r.data !== undefined ? r.data : r; }).catch(function (e) { toast(e.message || String(e), true); throw e; }); }
  function chip(s) { return '<span class="chip ' + esc(s) + '">' + esc(String(s).replace("_", " ")) + "</span>"; }
  function dt(s) { return new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
  function owner() { return B.role === "owner"; }
  function opts(list, cur) { return list.map(function (o) { return '<option' + (o === cur ? " selected" : "") + ">" + esc(o) + "</option>"; }).join(""); }
  function csv(rows, name) {
    var out = rows.map(function (r) { return r.map(function (c) { c = String(c == null ? "" : c); if (/^[=+\-@]/.test(c)) c = "'" + c; return '"' + c.replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + out], { type: "text/csv" })); a.download = name; a.click();
  }
  function dialog(html) {
    var d = document.createElement("dialog"); d.innerHTML = html; document.body.appendChild(d);
    d.addEventListener("close", function () { d.remove(); }); d.showModal(); return d;
  }

  /* ---------- sign in ---------- */
  function loginView(msg) {
    app.innerHTML = '<div class="login card"><h2>Namak Mandi admin</h2><form id="lf"><label class="f">Email<input type="email" id="le" autocomplete="username" required></label><label class="f">Password<input type="password" id="lp" autocomplete="current-password" required></label><p class="err" id="lerr">' + esc(msg || "") + '</p><button class="b" type="submit">Log in</button></form><p class="muted"><a href="../">← Back to the website</a></p></div>';
    $("lf").onsubmit = function (e) {
      e.preventDefault();
      db.auth.signInWithPassword({ email: $("le").value.trim(), password: $("lp").value }).then(function (r) {
        if (r.error) { $("lerr").textContent = "That email and password do not match."; return; }
        return B.loadMe().then(start);
      });
    };
  }
  function noAccess() {
    app.innerHTML = '<div class="login card"><h2>No admin access</h2><p>You are logged in as ' + esc(B.user.email) + ', but this account is not on the staff list. Ask the owner to add you.</p><button class="b" id="lo">Log out</button> <a href="../">Website</a></div>';
    $("lo").onclick = function () { db.auth.signOut().then(function () { location.reload(); }); };
  }

  /* ---------- shell ---------- */
  var TABS = [["overview", "Overview"], ["bookings", "Bookings"], ["orders", "Orders"], ["menu", "Menu"], ["content", "Website content", 1], ["members", "Members"], ["enquiries", "Enquiries"], ["settings", "Settings", 1]];
  var cur = "overview", timer = null, lastNew = null, badge = { orders: 0, bookings: 0, enquiries: 0 };
  function start() {
    if (!B.user) return loginView();
    if (!B.role) return noAccess();
    app.innerHTML = '<header class="top"><h1>Namak Mandi · Admin</h1><span class="muted" style="color:#dfe5d5">' + esc(B.user.email) + " · " + esc(B.role) + '</span><a href="../">Website</a><button id="out">Log out</button></header><nav class="tabs" id="tabs"></nav><main id="main"></main>';
    $("out").onclick = function () { db.auth.signOut().then(function () { location.reload(); }); };
    drawTabs(); go(location.hash.slice(1) || "overview");
    window.addEventListener("hashchange", function () { go(location.hash.slice(1)); });
    poll(); setInterval(poll, 30000);
  }
  function drawTabs() {
    $("tabs").innerHTML = TABS.filter(function (t) { return !t[2] || owner(); }).map(function (t) {
      var n = badge[t[0]] || 0;
      return '<button data-t="' + t[0] + '" class="' + (t[0] === cur ? "on" : "") + '">' + t[1] + (n ? '<span class="dot">' + n + "</span>" : "") + "</button>";
    }).join("");
    $("tabs").onclick = function (e) { var b = e.target.closest("[data-t]"); if (b) location.hash = b.dataset.t; };
  }
  function go(t) {
    if (!TABS.some(function (x) { return x[0] === t && (!x[2] || owner()); })) t = "overview";
    cur = t; drawTabs(); clearInterval(timer);
    var m = $("main"); m.innerHTML = '<p class="muted">Loading…</p>';
    var f = VIEWS[t]; Promise.resolve(f(m)).catch(function (e) { m.innerHTML = '<p class="err">' + esc(e.message || e) + "</p>"; });
  }
  function count(table, f) { var q = db.from(table).select("id", { count: "exact", head: true }); return f(q).then(function (r) { return r.count || 0; }); }
  function beep() { try { var c = new (window.AudioContext || window.webkitAudioContext)(), o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value = 880; g.gain.value = .15; o.start(); setTimeout(function () { o.stop(); c.close(); }, 350); } catch (e) {} }
  function poll() {
    Promise.all([
      count("orders", function (q) { return q.eq("status", "new"); }),
      count("bookings", function (q) { return q.eq("status", "pending").gte("date", today()); }),
      count("enquiries", function (q) { return q.eq("status", "new"); })
    ]).then(function (r) {
      if (lastNew !== null && r[0] > lastNew) { beep(); toast("New order received"); }
      lastNew = r[0]; badge = { orders: r[0], bookings: r[1], enquiries: r[2] }; if ($("tabs")) drawTabs();
    }).catch(function () {});
  }

  /* ---------- views ---------- */
  var VIEWS = {};

  VIEWS.overview = function (m) {
    var t = today();
    return Promise.all([
      count("bookings", function (q) { return q.eq("date", t).in("status", ["pending", "confirmed", "seated"]); }),
      count("bookings", function (q) { return q.eq("status", "pending").gte("date", t); }),
      count("orders", function (q) { return q.eq("status", "new"); }),
      count("orders", function (q) { return q.in("status", ["accepted", "preparing", "ready"]); }),
      db.from("orders").select("total").gte("created_at", t + "T00:00:00").neq("status", "cancelled"),
      count("profiles", function (q) { return q; }),
      count("enquiries", function (q) { return q.eq("status", "new"); })
    ]).then(function (r) {
      var rev = (r[4].data || []).reduce(function (a, o) { return a + Number(o.total); }, 0);
      m.innerHTML = "<h2>Today</h2>" + '<div class="grid">' + [
        ["Tables today", r[0], "bookings"], ["Bookings to confirm", r[1], "bookings"], ["New orders", r[2], "orders"], ["Orders in progress", r[3], "orders"],
        ["Order value today", money(rev), "orders"], ["Members", r[5], "members"], ["New enquiries", r[6], "enquiries"]
      ].map(function (c) { return '<a class="card stat" href="#' + c[2] + '" style="text-decoration:none;color:inherit"><span class="muted">' + c[0] + "</span><b>" + c[1] + "</b></a>"; }).join("") + "</div>" +
        '<p class="muted">Order values are totals of non-cancelled orders placed today. Payment is taken at the restaurant, not online.</p>';
    });
  };

  /* bookings */
  var BK = { from: null, status: "", q: "" };
  VIEWS.bookings = function (m) {
    BK.from = BK.from || today();
    function load() {
      var q = db.from("bookings").select("*").gte("date", BK.from).order("date").order("time").limit(400);
      if (BK.status) q = q.eq("status", BK.status);
      return q.then(function (r) {
        if (r.error) throw B.fail(r.error);
        var rows = (r.data || []).filter(function (b) { var s = (BK.q || "").toLowerCase(); return !s || (b.name + b.phone + b.ref + (b.email || "")).toLowerCase().indexOf(s) >= 0; });
        $("bkTable").innerHTML = rows.length ? '<div class="wrap"><table><tr><th>When</th><th>Guest</th><th>Party</th><th>Status</th><th>Table</th><th>Notes</th><th></th></tr>' + rows.map(function (b) {
          return '<tr data-id="' + b.id + '"><td><b>' + esc(b.date) + "</b><br>" + esc(b.time) + '<br><span class="muted">' + esc(b.ref) + "</span></td><td>" + esc(b.name) + '<br><a href="tel:' + esc(b.phone) + '">' + esc(b.phone) + "</a>" + (b.email ? '<br><span class="muted">' + esc(b.email) + "</span>" : "") + '<br><span class="muted">' + esc(b.source) + "</span></td><td>" + b.guests + "<br>" + esc(b.seating) + (b.notes ? '<br><i class="muted">' + esc(b.notes) + "</i>" : "") + (b.preorder ? '<br><button class="b ghost sm" data-act="pre">Pre-order</button>' : "") + '</td><td><select data-f="status">' + opts(["pending", "confirmed", "seated", "completed", "cancelled", "no_show"], b.status) + '</select></td><td><input data-f="table_label" value="' + esc(b.table_label) + '" size="6" maxlength="20"></td><td><input data-f="admin_notes" value="' + esc(b.admin_notes) + '" placeholder="internal note" maxlength="300"></td><td><button class="b sm" data-act="save">Save</button></td></tr>';
        }).join("") + "</table></div>" : '<p class="muted">No bookings match.</p>';
        $("bkTable")._rows = rows;
      });
    }
    m.innerHTML = '<h2>Table bookings</h2><div class="bar"><label>From <input type="date" id="bkFrom" value="' + BK.from + '"></label><select id="bkSt"><option value="">All statuses</option>' + opts(["pending", "confirmed", "seated", "completed", "cancelled", "no_show"], BK.status) + '</select><input id="bkQ" placeholder="Search name, phone, ref" value="' + esc(BK.q) + '"><button class="b" id="bkNew">+ Add booking</button><button class="b ghost" id="bkCsv">Export CSV</button></div><div id="bkTable"></div>';
    $("bkFrom").onchange = function () { BK.from = this.value || today(); load(); };
    $("bkSt").onchange = function () { BK.status = this.value; load(); };
    $("bkQ").oninput = function () { BK.q = this.value; load(); };
    $("bkCsv").onclick = function () { var rows = $("bkTable")._rows || []; csv([["Ref", "Date", "Time", "Name", "Phone", "Email", "Guests", "Seating", "Status", "Table", "Notes", "Source"]].concat(rows.map(function (b) { return [b.ref, b.date, b.time, b.name, b.phone, b.email, b.guests, b.seating, b.status, b.table_label, b.notes, b.source]; })), "bookings.csv"); };
    $("bkNew").onclick = function () {
      var d = dialog('<h3>Add a booking (phone or walk-in)</h3><form id="nbf"><div class="row2"><label class="f">Name<input id="nbn" required maxlength="80"></label><label class="f">Phone<input id="nbp" required maxlength="30"></label><label class="f">Date<input type="date" id="nbd" required value="' + today() + '"></label><label class="f">Time<input type="time" id="nbt" required value="19:00"></label><label class="f">Guests<input type="number" id="nbg" min="1" max="100" value="2"></label><label class="f">Source<select id="nbs"><option>phone</option><option>walk-in</option></select></label></div><label class="f">Notes<input id="nbo" maxlength="300"></label><p><button class="b" type="submit">Add as confirmed</button> <button class="b ghost" type="button" onclick="this.closest(\'dialog\').close()">Cancel</button></p></form>');
      d.querySelector("form").onsubmit = function (e) {
        e.preventDefault();
        run(db.from("bookings").insert({ name: $("nbn").value.trim(), phone: $("nbp").value.trim(), date: $("nbd").value, time: $("nbt").value, guests: Number($("nbg").value), source: $("nbs").value, notes: $("nbo").value.trim(), status: "confirmed" }), "Booking added").then(function () { d.close(); load(); });
      };
    };
    $("bkTable").onclick = function (e) {
      var b = e.target.closest("[data-act]"); if (!b) return; var tr = b.closest("tr"), id = tr.dataset.id;
      if (b.dataset.act === "save") run(db.from("bookings").update({ status: tr.querySelector('[data-f=status]').value, table_label: tr.querySelector('[data-f=table_label]').value.trim(), admin_notes: tr.querySelector('[data-f=admin_notes]').value.trim() }).eq("id", id), "Saved").then(poll);
      if (b.dataset.act === "pre") { var row = $("bkTable")._rows.filter(function (x) { return x.id === id; })[0]; dialog("<h3>Pre-order</h3><pre style='white-space:pre-wrap'>" + esc(JSON.stringify(row.preorder, null, 1)) + "</pre><button class='b' onclick=\"this.closest('dialog').close()\">Close</button>"); }
    };
    return load();
  };

  /* orders */
  var OR = { filter: "active" };
  var NEXT = { "new": ["accepted", "Accept"], accepted: ["preparing", "Start cooking"], preparing: ["ready", "Mark ready"], ready: ["completed", "Complete"] };
  VIEWS.orders = function (m) {
    function load() {
      var q = db.from("orders").select("*").order("created_at", { ascending: false }).limit(200);
      if (OR.filter === "active") q = q.in("status", ["new", "accepted", "preparing", "ready"]);
      else if (OR.filter === "today") q = q.gte("created_at", today() + "T00:00:00");
      return q.then(function (r) {
        if (r.error) throw B.fail(r.error);
        var rows = r.data || []; $("orList")._rows = rows;
        $("orList").innerHTML = rows.length ? rows.map(function (o) {
          var a = o.address || {}, nx = NEXT[o.status];
          return '<div class="card" data-id="' + o.id + '"><div class="bar" style="margin:0"><b style="font-size:18px">' + esc(o.ref) + "</b>" + chip(o.status) + "<span>" + (o.mode === "delivery" ? "🛵 Delivery" : "🛍 Collection") + "</span><span>" + esc(o.when_text) + '</span><span class="muted">' + dt(o.created_at) + '</span><b style="margin-left:auto">' + money(o.total) + "</b></div>" +
            "<p>" + (o.items || []).map(function (i) { return "<b>" + i.qty + "×</b> " + esc(i.name) + " <span class='muted'>(" + esc(i.variant) + ")</span>" + (i.spice ? " · " + esc(i.spice) : "") + (i.note ? " · <i>" + esc(i.note) + "</i>" : ""); }).join("<br>") + "</p>" +
            "<p>" + esc(o.name) + ' · <a href="tel:' + esc(o.phone) + '">' + esc(o.phone) + "</a>" + (o.email ? " · " + esc(o.email) : "") + (o.mode === "delivery" ? "<br>" + esc([a.line1, a.city, a.postcode].filter(Boolean).join(", ")) : "") + (o.notes ? "<br><i>Note: " + esc(o.notes) + "</i>" : "") + "</p>" +
            '<p class="muted">Subtotal ' + money(o.subtotal) + (o.discount > 0 ? " · " + esc(o.discount_label || "Discount") + " −" + money(o.discount) : "") + (o.reward > 0 ? " · Points reward −" + money(o.reward) : "") + (o.delivery_fee > 0 ? " · Delivery " + money(o.delivery_fee) : "") + (o.tip > 0 ? " · Tip " + money(o.tip) : "") + " · Pay on " + (o.mode === "delivery" ? "delivery" : "collection") + (o.user_id ? " · member" : "") + "</p>" +
            '<div class="bar noprint" style="margin:0">' + (nx ? '<button class="b" data-act="adv" data-to="' + nx[0] + '">' + nx[1] + "</button>" : "") + (o.status !== "completed" && o.status !== "cancelled" ? '<button class="b red ghost" data-act="adv" data-to="cancelled">Cancel</button>' : "") + '<button class="b ghost" data-act="print">Print</button><input data-f="admin_notes" placeholder="internal note" value="' + esc(o.admin_notes) + '"><button class="b ghost sm" data-act="note">Save note</button></div></div>';
        }).join("") : '<p class="muted">No orders to show.</p>';
      });
    }
    m.innerHTML = '<h2>Food orders</h2><div class="bar"><select id="orF"><option value="active">Open orders</option><option value="today">Today (all)</option><option value="all">Latest 200</option></select><button class="b ghost" id="orCsv">Export CSV</button><span class="muted">Refreshes every 25 seconds. A beep plays when a new order arrives.</span></div><div id="orList"></div>';
    $("orF").value = OR.filter;
    $("orF").onchange = function () { OR.filter = this.value; load(); };
    $("orCsv").onclick = function () { csv([["Ref", "Created", "Status", "Mode", "Name", "Phone", "Items", "Subtotal", "Discount", "Reward", "Delivery", "Tip", "Total"]].concat(($("orList")._rows || []).map(function (o) { return [o.ref, o.created_at, o.status, o.mode, o.name, o.phone, (o.items || []).map(function (i) { return i.qty + "x " + i.name + " (" + i.variant + ")"; }).join("; "), o.subtotal, o.discount, o.reward, o.delivery_fee, o.tip, o.total]; })), "orders.csv"); };
    $("orList").onclick = function (e) {
      var b = e.target.closest("[data-act]"); if (!b) return; var card = b.closest("[data-id]"), id = card.dataset.id;
      if (b.dataset.act === "adv") {
        if (b.dataset.to === "cancelled" && !confirm("Cancel this order? Any points the customer used are refunded.")) return;
        run(db.from("orders").update({ status: b.dataset.to }).eq("id", id), "Order updated").then(function () { load(); poll(); });
      }
      if (b.dataset.act === "note") run(db.from("orders").update({ admin_notes: card.querySelector("[data-f=admin_notes]").value.trim() }).eq("id", id), "Saved");
      if (b.dataset.act === "print") { var w = window.open("", "_blank", "width=380,height=600"); if (w) { w.document.write("<pre style='font:14px monospace;white-space:pre-wrap'>" + card.innerText.replace(/Save note|Print|Accept|Cancel|Start cooking|Mark ready|Complete/g, "").replace(/</g, "&lt;") + "</pre>"); w.document.close(); w.print(); } }
    };
    timer = setInterval(load, 25000);
    return load();
  };

  /* menu */
  VIEWS.menu = function (m) {
    function load() {
      return db.from("menu_items").select("*").order("sort").order("name").then(function (r) {
        if (r.error) throw B.fail(r.error); var rows = r.data || []; $("mnList")._rows = rows;
        $("mnList").innerHTML = '<div class="wrap"><table><tr><th>Dish</th><th>Category</th><th>Prices</th><th>Available</th>' + (owner() ? "<th></th>" : "") + "</tr>" + rows.map(function (d) {
          return '<tr data-id="' + esc(d.id) + '"><td><b>' + esc(d.name) + '</b><br><span class="muted">' + esc(d.id) + '</span></td><td>' + esc(d.cat) + "</td><td>" + (d.variants || []).map(function (v) { return esc(v[0]) + " " + money(v[1]); }).join("<br>") + '</td><td>' + (d.available ? '<button class="b ghost sm" data-act="off">Mark sold out</button>' : chip("sold out") + " " + esc(d.sold_out_note || "") + ' <button class="b sm" data-act="on">Back on</button>') + "</td>" + (owner() ? '<td><button class="b ghost sm" data-act="edit">Edit</button> <button class="b red sm" data-act="del">Delete</button></td>' : "") + "</tr>";
        }).join("") + "</table></div>";
      });
    }
    m.innerHTML = "<h2>Menu</h2>" + (owner() ? '<div class="bar"><button class="b" id="mnNew">+ Add dish</button></div>' : '<p class="muted">Staff can mark dishes sold out or back on. Only the owner can edit the menu.</p>') + '<div id="mnList"></div>';
    function edit(d) {
      d = d || { id: "", cat: "", name: "", descr: "", tags: [], img: "", variants: [["Regular", 0]], sort: 0, available: true };
      var cats = Array.from(new Set(($("mnList")._rows || []).map(function (x) { return x.cat; })));
      var dl = dialog('<h3>' + (d.id ? "Edit dish" : "Add dish") + '</h3><form id="mf"><div class="row2"><label class="f">Name<input id="mn" required maxlength="120" value="' + esc(d.name) + '"></label><label class="f">ID (letters, numbers, - _ ; cannot change later)<input id="mi" required pattern="[a-z0-9_-]{2,40}" value="' + esc(d.id) + '"' + (d.id ? " readonly" : "") + '></label><label class="f">Category<input id="mc" list="cats" required value="' + esc(d.cat) + '"><datalist id="cats">' + cats.map(function (c) { return '<option value="' + esc(c) + '">'; }).join("") + '</datalist></label><label class="f">Sort order<input type="number" id="ms" value="' + (d.sort || 0) + '"></label></div><label class="f">Description<textarea id="md" maxlength="600">' + esc(d.descr) + '</textarea></label><label class="f">Tags (comma separated, e.g. Halal, Spicy)<input id="mt" value="' + esc((d.tags || []).join(", ")) + '"></label><label class="f">Image path or URL (optional)<input id="mg" value="' + esc(d.img || "") + '"></label><label class="f">Sizes and prices, one per line as: Label | 12.50<textarea id="mv" required>' + esc((d.variants || []).map(function (v) { return v[0] + " | " + v[1]; }).join("\n")) + '</textarea></label><p><button class="b" type="submit">Save</button> <button class="b ghost" type="button" onclick="this.closest(\'dialog\').close()">Cancel</button></p></form>');
      dl.querySelector("form").onsubmit = function (e) {
        e.preventDefault();
        var vs = $("mv").value.split("\n").map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) { var p = l.split("|"); return [p[0].trim(), Number((p[1] || "").trim())]; });
        if (!vs.length || vs.some(function (v) { return !v[0] || !(v[1] >= 0) || isNaN(v[1]); })) return toast("Check the prices: one per line as Label | 12.50", true);
        var row = { id: $("mi").value.trim(), name: $("mn").value.trim(), cat: $("mc").value.trim(), descr: $("md").value.trim(), tags: $("mt").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean), img: $("mg").value.trim() || null, variants: vs, sort: Number($("ms").value) || 0 };
        run(db.from("menu_items").upsert(row), "Menu saved — the website updates immediately").then(function () { dl.close(); load(); });
      };
    }
    if (owner()) $("mnNew").onclick = function () { edit(); };
    $("mnList").onclick = function (e) {
      var b = e.target.closest("[data-act]"); if (!b) return; var id = b.closest("tr").dataset.id;
      var d = ($("mnList")._rows || []).filter(function (x) { return x.id === id; })[0];
      if (b.dataset.act === "off") { var n = prompt("Short note shown to guests (e.g. Sold out today)", "Sold out today"); if (n === null) return; run(db.rpc("set_dish_available", { p_id: id, p_available: false, p_note: n }), "Marked sold out").then(load); }
      if (b.dataset.act === "on") run(db.rpc("set_dish_available", { p_id: id, p_available: true }), "Back on the menu").then(load);
      if (b.dataset.act === "edit") edit(d);
      if (b.dataset.act === "del" && confirm("Delete “" + d.name + "” for good? To hide a dish for a day, use Mark sold out instead.")) run(db.from("menu_items").delete().eq("id", id), "Deleted").then(load);
    };
    return load();
  };

  /* generic list editor (journal, FAQs, promo codes) */
  function crud(host, title, table, pk, order, fields, summary, blank) {
    host.insertAdjacentHTML("beforeend", "<h3>" + title + '</h3><div class="bar"><button class="b sm" data-add>+ Add</button></div><div data-list></div>');
    var list = host.querySelector("[data-list]"), rows = [];
    function load() {
      return db.from(table).select("*").order(order).then(function (r) {
        rows = r.data || [];
        list.innerHTML = rows.length ? '<div class="wrap"><table>' + rows.map(function (x) { return "<tr><td>" + summary(x) + '</td><td style="white-space:nowrap"><button class="b ghost sm" data-e="' + esc(x[pk]) + '">Edit</button> <button class="b red sm" data-d="' + esc(x[pk]) + '">Delete</button></td></tr>'; }).join("") + "</table></div>" : '<p class="muted">Nothing yet.</p>';
      });
    }
    function form(x) {
      var isNew = !x; x = x || blank;
      var dl = dialog("<h3>" + (isNew ? "Add" : "Edit") + '</h3><form>' + fields.map(function (f) {
        var v = x[f.k] == null ? "" : x[f.k], ro = f.pk && !isNew ? " readonly" : "";
        if (f.type === "bool") return '<label class="f">' + f.l + '<select name="' + f.k + '"><option value="true"' + (v === true ? " selected" : "") + '>Yes</option><option value="false"' + (v === false ? " selected" : "") + ">No</option></select></label>";
        if (f.type === "area") return '<label class="f">' + f.l + '<textarea name="' + f.k + '" maxlength="' + (f.max || 2000) + '">' + esc(v) + "</textarea></label>";
        if (f.type === "sel") return '<label class="f">' + f.l + '<select name="' + f.k + '">' + opts(f.o, v) + "</select></label>";
        return '<label class="f">' + f.l + '<input name="' + f.k + '" type="' + (f.type || "text") + '" value="' + esc(v) + '"' + ro + (f.max ? ' maxlength="' + f.max + '"' : "") + (f.opt ? "" : " required") + "></label>";
      }).join("") + '<p><button class="b" type="submit">Save</button> <button class="b ghost" type="button" onclick="this.closest(\'dialog\').close()">Cancel</button></p></form>');
      dl.querySelector("form").onsubmit = function (e) {
        e.preventDefault(); var row = {};
        fields.forEach(function (f) { var el = dl.querySelector('[name="' + f.k + '"]'), v = el.value; row[f.k] = f.type === "bool" ? v === "true" : f.type === "number" ? Number(v) : (f.up ? v.trim().toUpperCase() : v.trim()); });
        run(db.from(table).upsert(row), "Saved").then(function () { dl.close(); load(); });
      };
    }
    host.querySelector("[data-add]").onclick = function () { form(); };
    list.onclick = function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.dataset.e != null) form(rows.filter(function (x) { return String(x[pk]) === b.dataset.e; })[0]);
      if (b.dataset.d != null && confirm("Delete this entry?")) run(db.from(table).delete().eq(pk, b.dataset.d), "Deleted").then(load);
    };
    return load();
  }

  /* website content */
  VIEWS.content = function (m) {
    return db.from("site_content").select("key,value").then(function (r) {
      var c = {}; (r.data || []).forEach(function (x) { c[x.key] = x.value; });
      m.innerHTML = '<h2>Website content</h2><div class="card"><h3 style="margin-top:0">Banner, headline and closure notice</h3><form id="cf"><label class="f">Show a banner across the top of the website?<select id="cbo"><option value="false">No</option><option value="true"' + (c.banner_on === "true" ? " selected" : "") + '>Yes</option></select></label><label class="f">Banner text (e.g. Closed Christmas Day)<input id="cbt" maxlength="200" value="' + esc(c.banner_text) + '"></label><label class="f">Banner link (optional, https://… or #menu)<input id="cbl" maxlength="200" value="' + esc(c.banner_link) + '"></label><label class="f">Homepage sentence under the title<textarea id="chs" maxlength="300">' + esc(c.hero_sub) + '</textarea></label><label class="f">Notice on the booking and checkout pages (leave empty for none; e.g. “Kitchen closes early on 24 Dec”)<input id="ccn" maxlength="300" value="' + esc(c.closure_note) + '"></label><p><button class="b" type="submit">Save</button></p></form></div><div id="jr"></div><div id="fq"></div>';
      $("cf").onsubmit = function (e) {
        e.preventDefault(); var l = $("cbl").value.trim();
        if (l && !/^(https?:\/\/|#|tel:|mailto:)/.test(l)) return toast("Link must start with https://, # , tel: or mailto:", true);
        run(db.from("site_content").upsert([{ key: "banner_on", value: $("cbo").value }, { key: "banner_text", value: $("cbt").value.trim() }, { key: "banner_link", value: l }, { key: "hero_sub", value: $("chs").value.trim() }, { key: "closure_note", value: $("ccn").value.trim() }]), "Saved — the website updates immediately");
      };
      return crud($("jr"), "Journal posts", "journal_posts", "id", "sort", [{ k: "title", l: "Title", max: 160 }, { k: "summary", l: "Short summary", type: "area", max: 300 }, { k: "body", l: "Full text", type: "area", max: 4000 }, { k: "sort", l: "Sort order", type: "number" }, { k: "published", l: "Published", type: "bool" }], function (x) { return "<b>" + esc(x.title) + "</b> " + (x.published ? "" : chip("hidden")) + '<br><span class="muted">' + esc(x.summary) + "</span>"; }, { sort: 0, published: true })
        .then(function () { return crud($("fq"), "FAQs", "faqs", "id", "sort", [{ k: "question", l: "Question", max: 200 }, { k: "answer", l: "Answer", type: "area", max: 1500 }, { k: "sort", l: "Sort order", type: "number" }, { k: "published", l: "Published", type: "bool" }], function (x) { return "<b>" + esc(x.question) + "</b> " + (x.published ? "" : chip("hidden")) + '<br><span class="muted">' + esc(x.answer.slice(0, 120)) + "</span>"; }, { sort: 0, published: true }); });
    });
  };

  /* members */
  VIEWS.members = function (m) {
    var qv = "";
    function load() {
      var q = db.from("profiles").select("*").order("created_at", { ascending: false }).limit(200);
      if (qv) { var s = qv.replace(/[%,()]/g, ""); q = q.or("full_name.ilike.%" + s + "%,email.ilike.%" + s + "%,phone.ilike.%" + s + "%"); }
      return q.then(function (r) {
        if (r.error) throw B.fail(r.error); var rows = r.data || []; $("mbList")._rows = rows;
        $("mbList").innerHTML = rows.length ? '<div class="wrap"><table><tr><th>Name</th><th>Contact</th><th>Points</th><th>Lifetime</th><th>Email offers</th><th>Joined</th><th></th></tr>' + rows.map(function (p) { return "<tr><td>" + esc(p.full_name || "—") + "</td><td>" + esc(p.email) + "<br>" + esc(p.phone) + "</td><td><b>" + p.points + "</b></td><td>" + p.lifetime_points + "</td><td>" + (p.marketing_opt_in ? "Yes" : "No") + "</td><td>" + dt(p.created_at) + '</td><td><button class="b ghost sm" data-id="' + p.id + '">Open</button></td></tr>'; }).join("") + "</table></div>" : '<p class="muted">No members found.</p>';
      });
    }
    m.innerHTML = '<h2>Members</h2><div class="bar"><input id="mbQ" placeholder="Search name, email, phone"><button class="b ghost" id="mbCsv">Export CSV (email-offer members only)</button></div><div id="mbList"></div><p class="muted">Only export and use contact details for people who ticked the email offers box.</p>';
    $("mbQ").oninput = function () { qv = this.value.trim(); clearTimeout($("mbQ")._t); $("mbQ")._t = setTimeout(load, 250); };
    $("mbCsv").onclick = function () { csv([["Name", "Email", "Phone"]].concat(($("mbList")._rows || []).filter(function (p) { return p.marketing_opt_in; }).map(function (p) { return [p.full_name, p.email, p.phone]; })), "members-email-offers.csv"); };
    $("mbList").onclick = function (e) {
      var b = e.target.closest("[data-id]"); if (!b) return;
      var p = $("mbList")._rows.filter(function (x) { return x.id === b.dataset.id; })[0];
      Promise.all([db.from("points_ledger").select("*").eq("user_id", p.id).order("created_at", { ascending: false }).limit(15), db.from("orders").select("ref,total,status,created_at").eq("user_id", p.id).order("created_at", { ascending: false }).limit(8)]).then(function (r) {
        var dl = dialog("<h3>" + esc(p.full_name || p.email) + "</h3><p>" + esc(p.email) + " · " + esc(p.phone) + (p.birthday ? " · Birthday " + esc(p.birthday) : "") + "</p><p><b>" + p.points + " points</b> (lifetime " + p.lifetime_points + ")</p>" +
          (owner() ? '<form id="adj" class="bar"><input type="number" id="adn" placeholder="+50 or -20" required style="width:110px"><input id="adr" placeholder="Reason" maxlength="200" required><button class="b sm" type="submit">Adjust points</button></form>' : "") +
          "<h3>Points history</h3>" + ((r[0].data || []).map(function (l) { return "<div>" + dt(l.created_at) + " · <b>" + (l.delta > 0 ? "+" : "") + l.delta + "</b> · " + esc(l.reason) + "</div>"; }).join("") || '<p class="muted">None</p>') +
          "<h3>Recent orders</h3>" + ((r[1].data || []).map(function (o) { return "<div>" + esc(o.ref) + " · " + money(o.total) + " · " + chip(o.status) + " · " + dt(o.created_at) + "</div>"; }).join("") || '<p class="muted">None</p>') + '<p><button class="b ghost" onclick="this.closest(\'dialog\').close()">Close</button></p>');
        if (owner()) dl.querySelector("#adj").onsubmit = function (e) { e.preventDefault(); run(db.rpc("admin_adjust_points", { p_user: p.id, p_delta: Number($("adn").value), p_reason: $("adr").value }), "Points updated").then(function () { dl.close(); load(); }); };
      });
    };
    return load();
  };

  /* enquiries */
  VIEWS.enquiries = function (m) {
    var f = "new";
    function load() {
      var q = db.from("enquiries").select("*").order("created_at", { ascending: false }).limit(200); if (f) q = q.eq("status", f);
      return q.then(function (r) {
        if (r.error) throw B.fail(r.error); var rows = r.data || [];
        $("enList").innerHTML = rows.length ? rows.map(function (x) {
          return '<div class="card" data-id="' + x.id + '"><div class="bar" style="margin:0"><b>' + esc(x.kind) + "</b>" + chip(x.status) + '<span class="muted">' + dt(x.created_at) + "</span></div><p>" + esc(x.name) + (x.phone ? ' · <a href="tel:' + esc(x.phone) + '">' + esc(x.phone) + "</a>" : "") + (x.email ? ' · <a href="mailto:' + esc(x.email) + '">' + esc(x.email) + "</a>" : "") + "</p><p>" + Object.keys(x.payload || {}).map(function (k) { return "<b>" + esc(k) + ":</b> " + esc(x.payload[k]); }).join("<br>") + '</p><div class="bar" style="margin:0"><input data-n value="' + esc(x.admin_notes) + '" placeholder="internal note"><button class="b sm" data-a="' + (x.status === "new" ? "done" : "new") + '">' + (x.status === "new" ? "Mark done" : "Reopen") + '</button><button class="b ghost sm" data-a="note">Save note</button></div></div>';
        }).join("") : '<p class="muted">Nothing here.</p>';
      });
    }
    m.innerHTML = '<h2>Enquiries</h2><div class="bar"><select id="enF"><option value="new">To do</option><option value="done">Done</option><option value="">All</option></select></div><div id="enList"></div>';
    $("enF").onchange = function () { f = this.value; load(); };
    $("enList").onclick = function (e) {
      var b = e.target.closest("[data-a]"); if (!b) return; var c = b.closest("[data-id]"), upd = { admin_notes: c.querySelector("[data-n]").value.trim() };
      if (b.dataset.a !== "note") upd.status = b.dataset.a;
      run(db.from("enquiries").update(upd).eq("id", c.dataset.id), "Saved").then(function () { load(); poll(); });
    };
    return load();
  };

  /* settings and promo codes */
  var DAYS = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];
  VIEWS.settings = function (m) {
    return db.from("settings").select("key,value").then(function (r) {
      var s = {}; (r.data || []).forEach(function (x) { s[x.key] = x.value; });
      function num(k, l, h) { return '<label class="f">' + l + '<input type="number" step="any" min="0" data-k="' + k + '" value="' + esc(s[k]) + '">' + (h ? '<span class="muted">' + h + "</span>" : "") + "</label>"; }
      m.innerHTML = '<h2>Settings</h2><form id="sf"><div class="card"><h3 style="margin-top:0">Namak Circle points and discounts</h3><div class="row2">' + num("points_per_pound", "Points per £1 spent", "On completed orders") + num("redeem_points", "Points needed for a reward") + num("redeem_value", "Reward value (£)", "Taken off automatically at checkout") + num("member_discount_pct", "Member discount on all orders (%)", "0 = none. Compared with promo codes: the larger one applies, they do not add up.") + '</div></div><div class="card"><h3 style="margin-top:0">Bookings and orders</h3><div class="row2"><label class="f">Online bookings<select data-k="bookings_open" data-t="bool"><option value="true"' + (s.bookings_open !== false ? " selected" : "") + '>Open</option><option value="false"' + (s.bookings_open === false ? " selected" : "") + '>Paused</option></select></label><label class="f">Online ordering<select data-k="orders_open" data-t="bool"><option value="true"' + (s.orders_open !== false ? " selected" : "") + '>Open</option><option value="false"' + (s.orders_open === false ? " selected" : "") + ">Paused</option></select></label>" + num("booking_max_guests", "Largest party online") + num("booking_days_ahead", "How many days ahead guests can book") + '<label class="f">Last booking time (HH:MM)<input data-k="last_booking" data-t="text" value="' + esc(s.last_booking || "22:00") + '" pattern="[0-2][0-9]:[0-5][0-9]"></label>' + num("delivery_min", "Minimum delivery order (£)") + '</div><label class="f">Closed dates (YYYY-MM-DD, separated by commas or lines)<textarea data-k="closed_dates" data-t="dates">' + esc((s.closed_dates || []).join("\n")) + '</textarea></label></div><div class="card"><h3 style="margin-top:0">Opening hours</h3><p class="muted">Use 24-hour numbers. Closing at midnight is 24.</p>' + DAYS.map(function (d) { var h = (s.hours || {})[d[0]] || [12, 24]; return '<div class="bar" style="margin:4px 0"><span style="width:100px">' + d[1] + '</span><input type="number" min="0" max="24" step="0.5" data-h="' + d[0] + '" data-i="0" value="' + h[0] + '" style="width:80px"> to <input type="number" min="0" max="24" step="0.5" data-h="' + d[0] + '" data-i="1" value="' + h[1] + '" style="width:80px"></div>'; }).join("") + '</div><div class="card"><h3 style="margin-top:0">Delivery zones (advanced)</h3><p class="muted">JSON list. Each zone: name, match (list of postcode patterns), fee, free_over, eta. Keep the format; a mistake is rejected before saving.</p><textarea data-k="delivery_zones" data-t="json" style="min-height:200px;font-family:monospace">' + esc(JSON.stringify(s.delivery_zones || [], null, 1)) + '</textarea></div><p><button class="b" type="submit">Save all settings</button></p></form><div id="pr"></div>';
      $("sf").onsubmit = function (e) {
        e.preventDefault(); var rows = [], bad = null;
        m.querySelectorAll("[data-k]").forEach(function (el) {
          var k = el.dataset.k, t = el.dataset.t, v;
          if (t === "bool") v = el.value === "true"; else if (t === "text") v = el.value.trim();
          else if (t === "dates") { v = el.value.split(/[\s,]+/).filter(Boolean); if (v.some(function (d) { return !/^\d{4}-\d{2}-\d{2}$/.test(d); })) bad = "Closed dates must look like 2026-12-25"; }
          else if (t === "json") { try { v = JSON.parse(el.value); if (!Array.isArray(v)) throw 0; } catch (x) { bad = "Delivery zones: that is not a valid list. Nothing was saved."; } }
          else { v = Number(el.value); if (isNaN(v) || v < 0) bad = "Check the numbers in the settings."; }
          rows.push({ key: k, value: v });
        });
        var hrs = {}; m.querySelectorAll("[data-h]").forEach(function (el) { var d = el.dataset.h; hrs[d] = hrs[d] || [12, 24]; hrs[d][Number(el.dataset.i)] = Number(el.value); });
        Object.keys(hrs).forEach(function (d) { if (!(hrs[d][0] < hrs[d][1])) bad = "Opening hours: closing must be after opening (" + d + ")"; });
        rows.push({ key: "hours", value: hrs });
        if (bad) return toast(bad, true);
        run(db.from("settings").upsert(rows), "Settings saved — the website updates immediately");
      };
      return crud($("pr"), "Promo codes", "promo_codes", "code", "code", [{ k: "code", l: "Code (capitals, no spaces)", pk: true, up: true, max: 30 }, { k: "type", l: "Type", type: "sel", o: ["pct", "freedel"] }, { k: "value", l: "Percent off (for pct)", type: "number" }, { k: "first_order_only", l: "First order only", type: "bool" }, { k: "active", l: "Active", type: "bool" }, { k: "note", l: "Internal note", type: "text", max: 200, opt: true }], function (x) { return "<b>" + esc(x.code) + "</b> · " + (x.type === "pct" ? x.value + "% off" : "Free delivery") + (x.first_order_only ? " · first order" : "") + " " + (x.active ? "" : chip("off")) + '<br><span class="muted">' + esc(x.note) + "</span>"; }, { type: "pct", value: 10, first_order_only: false, active: true, note: "" });
    });
  };

  B.ready.then(start);
  B.onChange(function () { if (!B.user && $("main")) loginView(); });
})();
