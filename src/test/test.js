import {
  Aa as a,
  Hd as g,
  Ma as s,
  Qa as d,
  j as f,
  na as m,
  ra as i,
} from "./chunk-XLBURALE.js";
function U(n) {
  n || (n = a(s));
  let e = new f((t) => {
    if (n.destroyed) {
      t.next();
      return;
    }
    return n.onDestroy(t.next.bind(t));
  });
  return (t) => t.pipe(m(e));
}
function L(n, e) {
  var v;
  let c = !(e != null && e.manualCleanup)
      ? ((v = e == null ? void 0 : e.injector) == null ? void 0 : v.get(s)) ??
        a(s)
      : null,
    l = y(e == null ? void 0 : e.equal),
    o;
  e != null && e.requireSync
    ? (o = d({ kind: 0 }, { equal: l }))
    : (o = d(
        { kind: 1, value: e == null ? void 0 : e.initialValue },
        { equal: l }
      ));
  let r,
    b = n.subscribe({
      next: (u) => o.set({ kind: 1, value: u }),
      error: (u) => {
        o.set({ kind: 2, error: u }), r == null || r();
      },
      complete: () => {
        r == null || r();
      },
    });
  if (e != null && e.requireSync && o().kind === 0) throw new i(601, !1);
  return (
    (r = c == null ? void 0 : c.onDestroy(b.unsubscribe.bind(b))),
    g(
      () => {
        let u = o();
        switch (u.kind) {
          case 1:
            return u.value;
          case 2:
            throw u.error;
          case 0:
            throw new i(601, !1);
        }
      },
      { equal: e == null ? void 0 : e.equal }
    )
  );
}
function y(n = Object.is) {
  return (e, t) => e.kind === 1 && t.kind === 1 && n(e.value, t.value);
}
export { U as a, L as b };
//# sourceMappingURL=chunk-GZI6AIRG.js.map
