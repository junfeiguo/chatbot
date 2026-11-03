/* Namak Mandi website: members, live menu/content, real booking and order requests.
   Loads after the page's own scripts and the back end client (nm-backend.js).
   It replaces a few of the page's demo functions with versions that talk to your Supabase database.
   If the back end is not configured (backend/config.js empty) this file does nothing. */
(function () {
  "use strict";
  var B = window.NMB;
  if (!B || !B.enabled) return;
  var esc = B.esc, money = B.money;
  function $(id) { return document.getElementById(id); }
  function q(sel, root) { return (root || document).querySelector(sel); }
  function safe(s) { return String(s == null ? "" : s).replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  var S = {}, C = {};
  var mine = { orders: [], bookings: [], ledger: [] };
  var DAYKEY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

  /* ================= live data: settings, content, menu, journal, FAQs ================= */
  function hoursFor(day) { var h = S.hours && S.hours[DAYKEY[day]]; return Array.isArray(h) && h.length === 2 ? h : [12, 24]; }
  function fmtH(h) { h = Number(h); if (h === 24 || h === 0) return "12am"; if (h === 12) return "12pm"; return h > 12 ? (h - 12) + "pm" : h + "am"; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function loadPublic() {
    var c = B.client;
    return Promise.all([
      c.from("settings").select("key,value"),
      c.from("site_content").select("key,value"),
      c.from("menu_items").select("*").order("sort"),
      c.from("journal_posts").select("*").eq("published", true).order("sort"),
      c.from("faqs").select("*").eq("published", true).order("sort")
    ]).then(function (r) {
      if (r[0].data) r[0].data.forEach(function (x) { S[x.key] = x.value; });
      if (r[1].data) r[1].data.forEach(function (x) { C[x.key] = x.value; });
      applySettings();
      applyContent();
      var changed = false;
      if (r[2].data && r[2].data.length) { applyMenu(r[2].data); changed = true; }
      if (r[3].data && r[3].data.length) {
        JOURNAL.length = 0;
        r[3].data.forEach(function (j) { JOURNAL.push({ t: safe(j.title), x: safe(j.summary), f: safe(j.body).replace(/\n/g, "<br>") }); });
        changed = true;
      }
      if (r[4].data && r[4].data.length) {
        FAQS.length = 0;
        r[4].data.forEach(function (f) { FAQS.push([safe(f.question), safe(f.answer).replace(/\n/g, "<br>")]); });
        changed = true;
      }
      if (changed) rerenderSite();
    }).catch(function (e) { if (window.console) console.warn("Live content not loaded; using the built-in version.", e); });
  }

  function applyMenu(rows) {
    MENU.length = 0;
    rows.forEach(function (r) {
      MENU.push({
        id: r.id, cat: r.cat, name: safe(r.name), desc: safe(r.descr), tags: r.tags || [], img: r.img || "",
        v: (r.variants || []).map(function (x) { return [String(x[0]), Number(x[1])]; })
      });
    });
    Object.keys(SOLDOUT).forEach(function (k) { delete SOLDOUT[k]; });
    rows.forEach(function (r) { if (!r.available) SOLDOUT[r.id] = safe(r.sold_out_note || "Sold out today"); });
    // keep the basket in step with the live menu and prices
    var changed = false;
    Object.keys(basket).forEach(function (key) {
      var it = basket[key], d = MENU.filter(function (m) { return m.id === it.id; })[0];
      var v = d && d.v.filter(function (x) { return x[0] === it.variant; })[0];
      if (!d || !v || SOLDOUT[it.id]) { delete basket[key]; changed = true; }
      else if (v[1] !== it.price) { it.price = v[1]; changed = true; }
    });
    if (changed) saveBasket();
  }
  function rerenderSite() {
    try { renderTabs(); renderMenu(); renderSig(); renderFeasts(); renderBasket(); renderJournal(); renderFaq(); } catch (e) { if (window.console) console.warn(e); }
  }

  function applySettings() {
    // booking form: guest numbers and times follow the settings
    var max = Number(S.booking_max_guests || 20), g = $("bkGuests");
    if (g && g.options.length !== max) {
      var cur = g.value;
      g.innerHTML = Array.from({ length: max }, function (_, i) { return '<option value="' + (i + 1) + '">' + (i + 1) + (i === 0 ? " guest" : " guests") + "</option>"; }).join("");
      g.value = cur && Number(cur) <= max ? cur : "2";
    }
    try { fillTimes(); paintStatus(); } catch (e) {}
    if (S.bookings_open === false) {
      var n = q("#bookPanel .times-note"); if (n) n.textContent = "Online bookings are paused right now. Please call 020 8767 6120.";
    }
  }
  function applyContent() {
    var bn = $("nmBanner");
    if (!bn) { bn = document.createElement("div"); bn.id = "nmBanner"; bn.className = "nm-banner"; var h = q("header.site"); if (h) h.parentNode.insertBefore(bn, h); }
    if (C.banner_on === "true" && C.banner_text) {
      bn.innerHTML = esc(C.banner_text) + (C.banner_link && /^(https?:\/\/|#|tel:|mailto:)/.test(C.banner_link) ? ' <a href="' + esc(C.banner_link) + '">Find out more</a>' : "");
      bn.hidden = false;
    } else bn.hidden = true;
    var hero = q(".hero .lede"); if (hero && C.hero_sub) hero.textContent = C.hero_sub;
    ["bookPanel .body", "coMain"].forEach(function (sel, i) {
      var host = i ? $("coMain") : q("#bookPanel .body"); if (!host) return;
      var id = "nmClosure" + i, el = $(id);
      if (!C.closure_note) { if (el) el.remove(); return; }
      if (!el) { el = document.createElement("div"); el.id = id; el.className = "nm-note"; host.parentNode.insertBefore(el, host); if (i === 0) host.insertBefore(el, host.firstChild); }
      el.textContent = C.closure_note;
    });
    if (document.querySelector(".demo")) document.querySelector(".demo").hidden = true;
  }

  // opening hours come from the settings
  window.openInfo = function () {
    var n = londonNow(), day = n.getDay(), h = n.getHours() + n.getMinutes() / 60, t = hoursFor(day);
    if (h >= t[0] && h < t[1]) return { open: true, msg: "Open now · Kitchen until " + fmtH(t[1]) };
    if (h < t[0]) return { open: false, msg: "Closed · Opens today at " + fmtH(t[0]) + " — order ahead for then" };
    return { open: false, msg: "Closed · Opens tomorrow at " + fmtH(hoursFor((day + 1) % 7)[0]) };
  };
  window.fillTimes = function () {
    var inp = $("bkDate"), sel = $("bkTime"), note = $("bkHoursNote");
    if (!inp.value) { sel.innerHTML = ""; return; }
    var day = new Date(inp.value + "T12:00:00").getDay(), t = hoursFor(day);
    var lb = String(S.last_booking || "22:00").split(":"), lastMin = Number(lb[0]) * 60 + Number(lb[1] || 0);
    if (Array.isArray(S.closed_dates) && S.closed_dates.indexOf(inp.value) >= 0) {
      sel.innerHTML = ""; note.textContent = "We are not taking online bookings that day. Please call us on 020 8767 6120."; return;
    }
    var out = [];
    for (var m = t[0] * 60; m <= Math.min(lastMin, t[1] * 60 - 30); m += 30) out.push(pad(Math.floor(m / 60)) + ":" + pad(m % 60));
    sel.innerHTML = out.map(function (x) { return "<option>" + x + "</option>"; }).join("");
    note.textContent = "We open at " + fmtH(t[0]) + " that day — last booking " + (S.last_booking || "22:00") + ", kitchen until " + fmtH(t[1]) + ".";
  };

  /* ================= bookings ================= */
  function show(id, html) { var el = $(id); if (!el) return; el.innerHTML = html; el.classList.add("show"); if (el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" }); }
  function busy(btn, on, label) { if (!btn) return; if (on) { btn._t = btn.textContent; btn.disabled = true; btn.textContent = label || "Sending…"; } else { btn.disabled = false; if (btn._t) btn.textContent = btn._t; } }
  var CALL = '<br><a class="btn small" href="tel:+442087676120">Call 020 8767 6120</a>';

  window.submitBooking = function (e) {
    e.preventDefault();
    var btn = e.target.querySelector('button[type="submit"]');
    var pre = $("bkPreorder").checked && basketCount() ? Object.keys(basket).map(function (k) { var i = basket[k]; return { id: i.id, variant: i.variant, qty: i.qty }; }) : null;
    var date = $("bkDate").value, time = $("bkTime").value;
    busy(btn, true);
    B.rpc("create_booking", {
      p_name: $("bkName").value.trim(), p_phone: $("bkPhone").value.trim(), p_email: $("bkEmail").value.trim() || null,
      p_guests: Number($("bkGuests").value), p_date: date, p_time: time, p_seating: $("bkSeating").value,
      p_notes: $("bkNotes").value.trim(), p_preorder: pre
    }).then(function (r) {
      var nice = new Date(date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
      show("bookSummary", "<b>Booking request received.</b><br>Reference <b>" + esc(r.ref) + "</b> · " + esc(nice) + " · " + esc(time) + " · " + esc($("bkGuests").value) + " guests<br>" +
        "Your table is confirmed only when we reply by phone or email. If you do not hear from us, please call." +
        (pre ? "<br>Your basket was attached as a pre-order." : "") + CALL);
      if (B.user) loadMine();
    }).catch(function (err) { show("bookSummary", "<b>We could not send that.</b><br>" + esc(err.message) + CALL); })
      .then(function () { busy(btn, false); });
    return false;
  };

  /* ================= checkout and orders ================= */
  var _zoneFor = window.zoneFor;
  window.zoneFor = function (pc) {
    var m = (pc || "").toUpperCase().replace(/\s+/g, " ").trim().match(/^([A-Z]{1,2}\d[A-Z\d]?)/);
    if (!m) return null;
    var zs = S.delivery_zones;
    if (!Array.isArray(zs)) return _zoneFor(pc);
    for (var i = 0; i < zs.length; i++) {
      var pats = zs[i].match || [];
      for (var j = 0; j < pats.length; j++) { try { if (new RegExp(pats[j]).test(m[1])) return { zone: zs[i].name, fee: Number(zs[i].fee), freeOver: Number(zs[i].free_over), eta: zs[i].eta || "" }; } catch (e) {} }
    }
    return { zone: "out" };
  };
  window.pointsBalance = function () { return B.profile ? Number(B.profile.points || 0) : 0; };
  function discountNow(sub) {
    var promoDisc = promo && promo.type === "pct" ? Math.round(sub * promo.val) / 100 : 0;
    var mp = Number(S.member_discount_pct || 0), memberDisc = B.user && mp > 0 ? Math.round(sub * mp) / 100 : 0;
    return { amount: Math.max(promoDisc, memberDisc), label: memberDisc > promoDisc ? "Member " + mp + "%" : (promoDisc ? promo.name : "") };
  }
  window.deliveryFee = function (disc) {
    if (orderMode === "collection") return 0;
    var z = zoneFor($("coPostcode").value); if (!z || z.zone === "out") return null;
    if (promo && promo.type === "freedel") return 0;
    var sub = basketTotal(); if (disc == null) disc = discountNow(sub).amount;
    return sub - disc >= z.freeOver ? 0 : z.fee;
  };
  window.totals = function () {
    var sub = basketTotal(), d = discountNow(sub), rp = Number(S.redeem_points || 100), rv = Number(S.redeem_value || 5);
    var reward = B.user && pointsBalance() >= rp && sub - d.amount > 0 ? Math.min(rv, sub - d.amount) : 0;
    var fee = deliveryFee(d.amount), tip = Math.round((sub - d.amount) * tipPct) / 100;
    var total = Math.max(0, Math.round((sub - d.amount - reward + (fee || 0) + tip) * 100) / 100);
    return { sub: sub, disc: d.amount, discLabel: d.label, reward: reward, fee: fee, tip: tip, total: total };
  };
  window.renderSummary = function () {
    var t = totals();
    $("sumSub").textContent = fmt(t.sub);
    $("rowDisc").style.display = t.disc ? "flex" : "none";
    $("discName").textContent = t.discLabel || "";
    $("sumDisc").textContent = "−" + fmt(t.disc);
    $("rowReward").style.display = t.reward ? "flex" : "none";
    var rr = q("#rowReward span:last-child"); if (rr) rr.textContent = "−" + fmt(t.reward);
    $("sumFee").textContent = t.fee === null ? "Enter postcode" : (t.fee === 0 ? "Free" : fmt(t.fee));
    $("rowTip").style.display = t.tip ? "flex" : "none";
    $("sumTip").textContent = fmt(t.tip);
    $("sumTotal").textContent = fmt(t.total);
    var z = zoneFor($("coPostcode").value);
    $("sumEta").textContent = orderMode === "collection" ? "Collection in about 15–25 min from the counter, Tooting." : (z && z.zone !== "out" ? "Estimated arrival: " + z.eta + " after the kitchen confirms." : "");
    $("payBtn").textContent = "Place order · pay when you " + (orderMode === "collection" ? "collect" : "receive it");
  };
  window.payChanged = function () { renderSummary(); };
  window.applyPromo = function () {
    var code = ($("coPromo").value || "").trim().toUpperCase(), msg = $("promoMsg");
    if (!code) { promo = null; msg.textContent = "Have a code? Enter it above."; renderSummary(); return; }
    B.rpc("check_promo", { p_code: code }).then(function (r) {
      if (r && r.valid) {
        promo = r.type === "pct" ? { type: "pct", val: Number(r.value), name: r.code } : { type: "freedel", name: r.code };
        msg.innerHTML = "✓ <b>" + esc(r.code) + " applied</b>" + (r.type === "pct" ? " — " + esc(r.value) + "% off." : " — delivery is on us.") + (r.first_order_only ? " First orders only, checked when you place the order." : "");
      } else { promo = null; msg.textContent = "That code isn't valid. Check it and try again."; }
      renderSummary();
    }).catch(function (e) { msg.textContent = e.message; });
  };

  var STEPS_C = ["Order received", "Accepted by the kitchen", "In the kitchen — over the fire", "Ready to collect", "Collected — enjoy"];
  var STEPS_D = ["Order received", "Accepted by the kitchen", "In the kitchen — over the fire", "Ready — on its way", "Delivered — enjoy"];
  var STATUS_IDX = { "new": 0, accepted: 1, preparing: 2, ready: 3, completed: 4 };
  function drawTracker(mode, status) {
    var tr = $("tracker"); if (!tr) return;
    if (status === "cancelled") { tr.innerHTML = '<div class="tstep now"><span class="ic">!</span><span><span class="tt">This order was cancelled</span><br><span class="ts">Please call us on 020 8767 6120 if you were not expecting this.</span></span></div>'; return; }
    var idx = STATUS_IDX[status] || 0, steps = mode === "delivery" ? STEPS_D : STEPS_C;
    tr.innerHTML = steps.map(function (s, i) { return '<div class="tstep' + (i < idx ? " done" : i === idx ? " now" : "") + '"><span class="ic">' + (i < idx ? "✓" : i + 1) + '</span><span><span class="tt">' + s + '</span><br><span class="ts">' + (i < idx ? "Done" : i === idx ? "Happening now" : "Coming up") + "</span></span></div>"; }).join("");
  }
  function showServerConfirmation(res, phone) {
    $("coMain").style.display = "none";
    var c = $("coConfirm"); c.style.display = "block";
    var h = q("h2", c); if (h) h.textContent = "Shukriya — order received";
    var stars = $("confStars"); if (stars && stars.parentNode) stars.parentNode.style.display = "none";
    $("confMeta").innerHTML = "Order <b>" + esc(res.ref) + "</b> · " + (res.mode === "delivery" ? "Delivery" : "Collection") + " · Total <b>" + money(res.total) + "</b>" +
      (res.points_to_earn ? "<br>You will earn <b>" + res.points_to_earn + " Namak Circle points</b> when the order is completed." : (B.user ? "" : "<br>Join Namak Circle to earn points on your next order.")) +
      "<br>Pay when you " + (res.mode === "collection" ? "collect" : "receive it") + ". Keep your order number: you can follow it below.";
    $("confSms").textContent = "The kitchen will call " + phone + " if anything needs checking.";
    drawTracker(res.mode, "new");
    if (trackTimer) clearInterval(trackTimer);
    var tick = function () {
      B.rpc("track_order", { p_ref: res.ref, p_phone: phone }).then(function (t) {
        if (t && t.found) { drawTracker(t.mode, t.status); if (t.status === "completed" || t.status === "cancelled") clearInterval(trackTimer); }
      }).catch(function () {});
    };
    trackTimer = setInterval(tick, 20000);
    if (c.scrollIntoView) c.scrollIntoView();
  }
  window.placeOrder = function (e) {
    e.preventDefault(); err("");
    var email = $("coEmail").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("A valid email is needed — we will use it for your order."), false;
    var name = "", phone = "", addr = null;
    if (orderMode === "delivery") {
      name = ($("coFirst").value + " " + $("coLast").value).trim(); phone = $("coPhone").value.trim();
      if (!$("coFirst").value.trim()) return err("Please add your first name for the driver."), false;
      if (!$("coAddr").value.trim()) return err("Please add your delivery address."), false;
      var z = zoneFor($("coPostcode").value);
      if (!z) return err("Please add a valid UK postcode."), false;
      if (z.zone === "out") return err("That postcode is outside our delivery area — switch to Collection, or find us on Uber Eats / Deliveroo / Just Eat."), false;
      if (basketTotal() < Number(S.delivery_min || 12)) return err("Direct delivery starts at £" + Number(S.delivery_min || 12) + " — add a little more, or switch to collection."), false;
      if (phone.replace(/\D/g, "").length < 7) return err("Please add a phone number the driver can reach."), false;
      addr = { line1: $("coAddr").value.trim() + ($("coAddr2").value.trim() ? ", " + $("coAddr2").value.trim() : ""), city: $("coCity").value.trim(), postcode: $("coPostcode").value.trim() };
    } else {
      name = $("coNameC").value.trim(); phone = $("coPhoneC").value.trim();
      if (!name) return err("Please add the name for the collection order."), false;
      if (phone.replace(/\D/g, "").length < 7) return err("Please add a phone number so we can call when it is ready."), false;
    }
    if (!basketCount()) return err("Your basket is empty."), false;
    var items = Object.keys(basket).map(function (k) { var i = basket[k]; return { id: i.id, variant: i.variant, qty: i.qty, spice: i.spice || "", note: i.note || "" }; });
    var btn = $("payBtn"); busy(btn, true, "Placing your order…");
    B.rpc("create_order", {
      p_items: items, p_mode: orderMode, p_name: name, p_phone: phone, p_email: email, p_address: addr,
      p_when: orderWhen === "later" ? $("coWhen").value : "ASAP", p_notes: $("coNotes").value.trim(), p_tip_pct: tipPct, p_promo: promo ? promo.name : null
    }).then(function (res) {
      basket = {}; saveBasket(); promo = null;
      showServerConfirmation(res, phone);
      if (B.user) B.refreshMe().then(loadMine);
    }).catch(function (er) { err(er.message); })
      .then(function () { busy(btn, false); });
    return false;
  };

  function itemsText(items) { return (items || []).map(function (i) { return esc(i.name) + " (" + esc(i.variant) + ") × " + i.qty; }).join(" · "); }
  window.renderHistory = function () {
    var box = $("orderHistory"); if (!box) return;
    var pb = $("pointsBalance"), pn = $("pointsNote");
    if (!B.user) {
      pb.textContent = "— pts"; pn.textContent = "Join to start earning points on every direct order.";
      box.innerHTML = '<p class="note">Log in or join Namak Circle to see your points, past orders and one-tap reorders here.</p><button class="btn small" type="button" data-nm-open="join">Join or log in</button>';
      return;
    }
    var rp = Number(S.redeem_points || 100), rv = Number(S.redeem_value || 5), p = pointsBalance();
    pb.textContent = p + " pts";
    pn.textContent = p >= rp ? "You have a £" + rv + " reward — it comes off automatically at checkout." : "Earn " + (rp - p) + " more points for £" + rv + " off.";
    if (!mine.orders.length) { box.innerHTML = '<p class="note">No orders yet. Your first direct order will appear here, with a one-tap reorder.</p>'; return; }
    box.innerHTML = mine.orders.slice(0, 5).map(function (o) {
      return '<div class="order-card"><h4>Order ' + esc(o.ref) + " · " + money(o.total) + '</h4><p class="note">' + new Date(o.created_at).toLocaleString("en-GB") + " · " + (o.mode === "delivery" ? "Delivery" : "Collection") + " · " + esc(o.status) + '</p><p style="font-size:14px;margin:6px 0">' + itemsText(o.items) + '</p><button class="btn ghost small" onclick="reorder(\'' + esc(o.ref) + '\')">↻ Reorder this</button></div>';
    }).join("");
  };
  window.reorder = function (ref) {
    var o = mine.orders.filter(function (x) { return x.ref === ref; })[0]; if (!o) return;
    var skipped = 0;
    o.items.forEach(function (i) {
      var d = dishById(i.id); if (!d || SOLDOUT[i.id]) { skipped++; return; }
      var v = d.v.filter(function (x) { return x[0] === i.variant; })[0] || d.v[0], key = i.id + "|" + v[0];
      if (!basket[key]) basket[key] = { id: i.id, variant: v[0], price: v[1], qty: 0 };
      basket[key].qty += i.qty;
    });
    saveBasket(); closeAcct(); openPanel("basketPanel");
    toast(skipped ? "Rebuilt your order — " + skipped + " unavailable dish was left out" : "Your order is back in the basket");
  };

  /* checkout text: payment happens at the restaurant */
  function tidyCheckout() {
    document.querySelectorAll(".pay-opt, #cardFields").forEach(function (e) { e.style.display = "none"; });
    var h3s = document.querySelectorAll("h3.co-h"), ph = null;
    h3s.forEach(function (h) { if (/^payment$/i.test(h.textContent.trim())) ph = h; });
    if (ph) { var nt = ph.nextElementSibling; if (nt && nt.classList.contains("note")) nt.textContent = "Nothing is charged online. You pay the restaurant when you collect, or when your order arrives."; }
    var bn = q("#basketPanel .foot .note"); if (bn) bn.textContent = "Nothing is charged online: you pay when you collect or when it arrives. Discount codes and Namak Circle points are applied at checkout.";
    var co = q("#collectionFields .ship-box"); if (co) co.innerHTML = "Collect from the counter: <b>Namak Mandi, 25 Upper Tooting Road, London SW17 7TS</b>. You pay at the counter.";
    var pi = $("coPromo"); if (pi) pi.placeholder = "Discount code";
    var pm = $("promoMsg"); if (pm) pm.textContent = "Have a code? Enter it above.";
    var cm = $("coMarketing"); if (cm && cm.closest("label")) cm.closest("label").style.display = "none";
  }

  /* ================= events, gift cards, newsletter ================= */
  function enquiry(kind, name, phone, email, payload, boxId, okHtml, btn) {
    busy(btn, true);
    return B.rpc("create_enquiry", { p_kind: kind, p_name: name, p_phone: phone, p_email: email, p_payload: payload })
      .then(function () { show(boxId, okHtml); return true; })
      .catch(function (er) { show(boxId, "<b>We could not send that.</b><br>" + esc(er.message) + CALL); return false; })
      .then(function (okk) { busy(btn, false); return okk; });
  }
  window.submitEvent = function (e) {
    e.preventDefault();
    enquiry("event", $("evName").value.trim(), $("evPhone").value.trim(), $("evEmail").value.trim(),
      { date: $("evDate").value, guests: $("evGuests").value, type: $("evType").value, message: $("evMsg").value.trim() },
      "eventSummary", "<b>Thank you — your enquiry has reached the events team.</b><br>We will get back to you by phone or email." + CALL, e.target.querySelector('button[type="submit"]'));
    return false;
  };
  window.submitGift = function (e) {
    e.preventDefault();
    enquiry("gift", $("gfName").value.trim(), $("gfPhone").value.trim(), "",
      { amount: giftAmt, for: $("gfFor").value.trim(), message: $("gfMsg").value.trim() },
      "giftSummary", "<b>Gift card request received.</b><br>Nothing has been charged. We will contact you to confirm and arrange payment." + CALL, e.target.querySelector('button[type="submit"]'));
    return false;
  };
  window.submitNews = function (e) {
    e.preventDefault();
    enquiry("newsletter", $("nwName").value.trim(), "", $("nwEmail").value.trim(), {}, "newsSummary",
      "Thank you, " + esc($("nwName").value.trim()) + ". You are on the list.", e.target.querySelector('button[type="submit"]'));
    return false;
  };

  /* ================= login button and member area ================= */
  var acct = document.createElement("div");
  acct.id = "nmAcct"; acct.className = "nm-modal"; acct.hidden = true;
  acct.setAttribute("role", "dialog"); acct.setAttribute("aria-modal", "true"); acct.setAttribute("aria-label", "Your account");
  acct.innerHTML = '<div class="nm-card"><button class="nm-x" type="button" data-nm="close" aria-label="Close">×</button><div id="nmBody"></div></div>';
  document.body.appendChild(acct);

  var loginBtn = document.createElement("button");
  loginBtn.id = "nmLoginBtn"; loginBtn.type = "button"; loginBtn.className = "btn small ghost nm-login";
  var tools = q(".nav .tools"); if (tools) tools.insertBefore(loginBtn, tools.firstChild);
  function paintLogin() {
    if (B.user) { var nm = (B.profile && B.profile.full_name || "").split(" ")[0] || "Account"; loginBtn.innerHTML = '<span class="nm-lab">' + esc(nm) + '</span><span class="nm-ico" aria-hidden="true">👤</span>'; loginBtn.setAttribute("aria-label", "Your account"); }
    else { loginBtn.innerHTML = '<span class="nm-lab">Log in</span><span class="nm-ico" aria-hidden="true">👤</span>'; loginBtn.setAttribute("aria-label", "Log in or join"); }
  }
  var view = "login", tab = "overview", msg = "";
  function openAcct(v) { view = v || (B.user ? "member" : "login"); msg = ""; if (B.user) loadMine(); renderAcct(); acct.hidden = false; document.body.classList.add("nm-lock"); var f = q("input,button.nm-primary", $("nmBody")); if (f) setTimeout(function () { f.focus(); }, 30); }
  function closeAcct() { acct.hidden = true; document.body.classList.remove("nm-lock"); loginBtn.focus && loginBtn.focus(); }
  window.nmOpenAccount = openAcct;
  loginBtn.addEventListener("click", function () { openAcct(); });
  document.addEventListener("click", function (e) { var t = e.target.closest("[data-nm-open]"); if (t) { e.preventDefault(); openAcct(B.user ? "member" : t.dataset.nmOpen === "join" ? "join" : "login"); } });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !acct.hidden) closeAcct(); });
  acct.addEventListener("click", function (e) { if (e.target === acct) closeAcct(); });

  function loadMine() {
    if (!B.user) { mine = { orders: [], bookings: [], ledger: [] }; renderHistory(); return Promise.resolve(); }
    var c = B.client;
    return Promise.all([
      c.from("orders").select("ref,created_at,status,mode,total,items,points_awarded,points_used,when_text").order("created_at", { ascending: false }).limit(20),
      c.from("bookings").select("id,ref,date,time,guests,status,seating").order("date", { ascending: false }).limit(20),
      c.from("points_ledger").select("delta,reason,created_at").order("created_at", { ascending: false }).limit(12)
    ]).then(function (r) {
      mine.orders = r[0].data || []; mine.bookings = r[1].data || []; mine.ledger = r[2].data || [];
      renderHistory(); if (!acct.hidden && view === "member") renderAcct();
    });
  }

  function fieldRow(label, html) { return '<div class="nm-f"><label>' + label + "</label>" + html + "</div>"; }
  function msgHtml() { return msg ? '<p class="nm-msg" role="alert">' + msg + "</p>" : ""; }
  function renderAcct() {
    var el = $("nmBody"), html = "";
    if (B.recovery) view = "recovery";
    if (view === "login" || view === "join" || view === "forgot") {
      html += '<h2>Namak Circle</h2><p class="nm-sub">Join to earn points on every direct order, keep your details for faster booking, and see your orders in one place.</p>';
      html += '<div class="nm-tabs" role="tablist"><button type="button" class="' + (view !== "join" ? "on" : "") + '" data-nm="view-login">Log in</button><button type="button" class="' + (view === "join" ? "on" : "") + '" data-nm="view-join">Join</button></div>';
      if (view === "login") {
        html += '<form id="nmLogin" novalidate>' + fieldRow("Email", '<input type="email" id="nmEmail" autocomplete="email" required>') + fieldRow("Password", '<input type="password" id="nmPass" autocomplete="current-password" required>') + msgHtml() +
          '<button class="btn nm-primary" type="submit">Log in</button><p class="nm-small"><button type="button" class="nm-link" data-nm="view-forgot">Forgot your password?</button></p></form>';
      } else if (view === "forgot") {
        html += '<form id="nmForgot" novalidate><p class="nm-sub">Enter your email and we will send a link to choose a new password.</p>' + fieldRow("Email", '<input type="email" id="nmEmail" autocomplete="email" required>') + msgHtml() +
          '<button class="btn nm-primary" type="submit">Send the link</button> <button type="button" class="nm-link" data-nm="view-login">Back</button></form>';
      } else {
        html += '<form id="nmJoin" novalidate>' + fieldRow("Your name", '<input type="text" id="nmName" autocomplete="name" required maxlength="80">') + fieldRow("Email", '<input type="email" id="nmEmail" autocomplete="email" required>') +
          fieldRow("Phone (optional)", '<input type="tel" id="nmPhone" autocomplete="tel" maxlength="30">') + fieldRow("Password (8 or more characters)", '<input type="password" id="nmPass" autocomplete="new-password" minlength="8" required>') +
          '<label class="nm-check"><input type="checkbox" id="nmMkt"> Email me news, feast nights and offers. You can change this any time.</label>' +
          '<p class="nm-small">We use your details to run your membership, bookings and orders. See our <a href="privacy.html" target="_blank" rel="noopener">privacy notice</a>.</p>' + msgHtml() +
          '<button class="btn nm-primary" type="submit">Create my account</button></form>';
      }
    } else if (view === "recovery") {
      html += '<h2>Choose a new password</h2><form id="nmRecover" novalidate>' + fieldRow("New password (8 or more characters)", '<input type="password" id="nmPass" autocomplete="new-password" minlength="8" required>') + msgHtml() + '<button class="btn nm-primary" type="submit">Save password</button></form>';
    } else if (view === "member" && B.user) {
      var p = B.profile || {}, pts = Number(p.points || 0), rp = Number(S.redeem_points || 100), rv = Number(S.redeem_value || 5), pc = Math.min(100, Math.round((pts / rp) * 100));
      html += '<h2>Hello, ' + esc((p.full_name || "").split(" ")[0] || "friend") + '</h2><p class="nm-sub">' + esc(B.user.email || "") + "</p>";
      if (B.role) html += '<p><a class="btn small" href="admin/">Open the admin dashboard</a></p>';
      html += '<div class="nm-tabs" role="tablist">' + ["overview", "orders", "bookings", "details"].map(function (t) { return '<button type="button" class="' + (tab === t ? "on" : "") + '" data-nm="tab-' + t + '">' + t.charAt(0).toUpperCase() + t.slice(1) + "</button>"; }).join("") + "</div>";
      if (tab === "overview") {
        var mp = Number(S.member_discount_pct || 0);
        html += '<div class="nm-points"><div class="nm-pn">' + pts + '<small> points</small></div><div class="nm-bar"><i style="width:' + pc + '%"></i></div><p class="nm-small">' +
          (pts >= rp ? "You have a £" + rv + " reward. It comes off your next direct order automatically." : "Earn " + (rp - pts) + " more points for £" + rv + " off.") + "</p></div>";
        html += '<p class="nm-small">How it works: ' + esc(S.points_per_pound || 1) + " point for every £1 on a completed direct order. At " + rp + " points we take £" + rv + " off your next order, automatically." + (mp > 0 ? " Members also get " + mp + "% off direct orders." : "") + "</p>";
        html += "<h3>Points history</h3>" + (mine.ledger.length ? '<ul class="nm-list">' + mine.ledger.map(function (l) { return "<li><span>" + esc(l.reason) + '<br><small>' + new Date(l.created_at).toLocaleDateString("en-GB") + '</small></span><b class="' + (l.delta < 0 ? "neg" : "pos") + '">' + (l.delta > 0 ? "+" : "") + l.delta + "</b></li>"; }).join("") + "</ul>" : '<p class="nm-small">No points yet. Your first completed order starts your balance.</p>');
      } else if (tab === "orders") {
        html += mine.orders.length ? '<ul class="nm-list">' + mine.orders.map(function (o) { return "<li><span><b>" + esc(o.ref) + "</b> · " + money(o.total) + ' · <span class="nm-chip ' + esc(o.status) + '">' + esc(o.status) + "</span><br><small>" + new Date(o.created_at).toLocaleString("en-GB") + " · " + itemsText(o.items) + '</small></span><button class="btn ghost small" type="button" onclick="reorder(\'' + esc(o.ref) + '\')">Reorder</button></li>'; }).join("") + "</ul>" : '<p class="nm-small">No orders yet.</p>';
      } else if (tab === "bookings") {
        var today = new Date().toISOString().slice(0, 10);
        html += mine.bookings.length ? '<ul class="nm-list">' + mine.bookings.map(function (b) { var can = (b.status === "pending" || b.status === "confirmed") && b.date >= today; return "<li><span><b>" + esc(new Date(b.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })) + " · " + esc(b.time) + "</b> · " + b.guests + ' guests · <span class="nm-chip ' + esc(b.status) + '">' + esc(b.status) + "</span><br><small>" + esc(b.ref) + " · " + esc(b.seating) + "</small></span>" + (can ? '<button class="btn ghost small" type="button" data-nm="cancel-' + esc(b.id) + '">Cancel</button>' : "") + "</li>"; }).join("") + "</ul>" : '<p class="nm-small">No bookings yet.</p>';
        html += '<p><button class="btn small" type="button" onclick="nmCloseAndBook()">Book a table</button></p>';
      } else {
        html += '<form id="nmDetails" novalidate>' + fieldRow("Your name", '<input type="text" id="nmName" value="' + esc(p.full_name || "") + '" maxlength="80">') + fieldRow("Phone", '<input type="tel" id="nmPhone" value="' + esc(p.phone || "") + '" maxlength="30">') +
          fieldRow("Birthday (optional, for an annual treat)", '<input type="date" id="nmBday" value="' + esc(p.birthday || "") + '">') + '<label class="nm-check"><input type="checkbox" id="nmMkt"' + (p.marketing_opt_in ? " checked" : "") + "> Email me news, feast nights and offers</label>" + msgHtml() +
          '<button class="btn nm-primary" type="submit">Save my details</button></form>' +
          '<p class="nm-small"><button type="button" class="nm-link" data-nm="logout">Log out</button> · <button type="button" class="nm-link danger" data-nm="delete">Delete my account</button></p>';
      }
      if (tab !== "details") html += '<p class="nm-small"><button type="button" class="nm-link" data-nm="logout">Log out</button></p>';
    } else { view = "login"; return renderAcct(); }
    el.innerHTML = html;
  }
  window.nmCloseAndBook = function () { closeAcct(); openPanel("bookPanel"); };

  function setMsg(m, ok) { msg = ok ? '<span class="ok">' + m + "</span>" : m; renderKeep(); }
  function renderKeep() { var vals = {}; acct.querySelectorAll("input").forEach(function (i) { if (i.id && i.type !== "password") vals[i.id] = i.type === "checkbox" ? i.checked : i.value; }); renderAcct(); Object.keys(vals).forEach(function (id) { var i = $(id); if (i) { if (i.type === "checkbox") i.checked = vals[id]; else i.value = vals[id]; } }); }
  function redirectTo() { return location.origin + location.pathname; }
  function loginErr(e) { var m = (e && e.message) || ""; if (/invalid login/i.test(m)) return "That email and password do not match."; if (/not confirmed/i.test(m)) return "Please confirm your email first. Check your inbox for our message."; if (/rate limit/i.test(m)) return "Too many tries. Please wait a few minutes."; return esc(m || "Something went wrong. Please try again."); }

  acct.addEventListener("click", function (e) {
    var t = e.target.closest("[data-nm]"); if (!t) return; var a = t.dataset.nm;
    if (a === "close") return closeAcct();
    if (a.indexOf("view-") === 0) { view = a.slice(5); msg = ""; return renderAcct(); }
    if (a.indexOf("tab-") === 0) { tab = a.slice(4); msg = ""; return renderAcct(); }
    if (a === "logout") { B.client.auth.signOut().then(function () { closeAcct(); toast("You are logged out"); }); }
    if (a === "delete") {
      if (!window.confirm("Delete your account? Your points and member details are removed for good. Past orders stay with the restaurant without your name linked.")) return;
      B.rpc("delete_my_account").then(function () { return B.client.auth.signOut(); }).then(function () { closeAcct(); toast("Your account has been deleted"); }).catch(function (er) { setMsg(esc(er.message)); });
    }
    if (a.indexOf("cancel-") === 0) {
      if (!window.confirm("Cancel this booking?")) return;
      B.rpc("cancel_my_booking", { p_id: a.slice(7) }).then(function (ok) { toast(ok ? "Booking cancelled" : "That booking cannot be cancelled online. Please call us."); return loadMine(); }).catch(function (er) { toast(er.message); });
    }
  });
  acct.addEventListener("submit", function (e) {
    e.preventDefault(); var id = e.target.id, btn = e.target.querySelector("button[type=submit]");
    function go(p) { busy(btn, true, "One moment…"); return p.then(function () { busy(btn, false); }, function (er) { busy(btn, false); throw er; }); }
    var email = ($("nmEmail") || {}).value, pass = ($("nmPass") || {}).value;
    if (id === "nmLogin") {
      if (!email || !pass) return setMsg("Please enter your email and password.");
      go(B.client.auth.signInWithPassword({ email: email.trim(), password: pass }).then(function (r) { if (r.error) throw r.error; return B.loadMe(); }).then(function () { return loadMine(); }).then(function () { view = "member"; tab = "overview"; msg = ""; renderAcct(); paintLogin(); toast("Welcome back"); })).catch(function (er) { setMsg(loginErr(er)); });
    } else if (id === "nmJoin") {
      var name = $("nmName").value.trim();
      if (!name) return setMsg("Please tell us your name.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) return setMsg("That email address does not look right.");
      if (!pass || pass.length < 8) return setMsg("Please choose a password of 8 or more characters.");
      go(B.client.auth.signUp({ email: email.trim(), password: pass, options: { data: { full_name: name, phone: $("nmPhone").value.trim(), marketing_opt_in: $("nmMkt").checked }, emailRedirectTo: redirectTo() } }).then(function (r) {
        if (r.error) throw r.error;
        if (r.data && r.data.session) { return B.loadMe().then(function () { view = "member"; tab = "overview"; msg = ""; renderAcct(); paintLogin(); toast("Welcome to Namak Circle"); }); }
        view = "login"; setMsg("Almost there. We sent a message to " + esc(email.trim()) + ". Open it and tap the link to confirm, then log in here.", true);
      })).catch(function (er) { setMsg(loginErr(er)); });
    } else if (id === "nmForgot") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) return setMsg("Please enter your email address.");
      go(B.client.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectTo() }).then(function (r) { if (r.error) throw r.error; view = "login"; setMsg("If that email has an account, a reset link is on its way.", true); })).catch(function (er) { setMsg(loginErr(er)); });
    } else if (id === "nmRecover") {
      if (!pass || pass.length < 8) return setMsg("Please choose a password of 8 or more characters.");
      go(B.client.auth.updateUser({ password: pass }).then(function (r) { if (r.error) throw r.error; B.recovery = false; view = "member"; setMsg("Your password has been changed.", true); })).catch(function (er) { setMsg(loginErr(er)); });
    } else if (id === "nmDetails") {
      go(B.client.from("profiles").update({ full_name: $("nmName").value.trim(), phone: $("nmPhone").value.trim(), birthday: $("nmBday").value || null, marketing_opt_in: $("nmMkt").checked }).eq("id", B.user.id).then(function (r) { if (r.error) throw r.error; return B.loadMe(); }).then(function () { paintLogin(); setMsg("Saved.", true); prefill(); })).catch(function (er) { setMsg(esc(er.message)); });
    }
  });

  function prefill() {
    if (!B.user) return;
    var p = B.profile || {}, set = function (id, v) { var e = $(id); if (e && !e.value && v) e.value = v; };
    set("bkName", p.full_name); set("bkPhone", p.phone); set("bkEmail", B.user.email);
    set("coEmail", B.user.email); set("coNameC", p.full_name); set("coPhoneC", p.phone); set("coPhone", p.phone);
    var parts = (p.full_name || "").split(" "); set("coFirst", parts[0]); set("coLast", parts.slice(1).join(" "));
  }

  B.onChange(function () { paintLogin(); prefill(); loadMine(); try { renderSummary(); } catch (e) {} if (B.recovery) openAcct("recovery"); });

  /* ================= start ================= */
  tidyCheckout();
  paintLogin();
  renderHistory();
  loadPublic();
})();
