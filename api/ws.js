import { createServer } from "node:http";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { createClient } from "@redis/client";
var MAX_DEPTH$1 = 40;
var FUNCS = {
	sin: Math.sin,
	cos: Math.cos,
	tan: Math.tan,
	ln: Math.log,
	log: Math.log10,
	sqrt: Math.sqrt,
	abs: Math.abs,
	exp: Math.exp,
	asin: Math.asin,
	acos: Math.acos,
	atan: Math.atan
};
var CONSTS = {
	pi: Math.PI,
	e: Math.E
};
var NAMES = [
	...Object.keys(FUNCS),
	...Object.keys(CONSTS),
	"x"
].sort((a, b) => b.length - a.length);
var ExprError = class extends Error {
	pos;
	constructor(message, pos) {
		super(message);
		this.pos = pos;
	}
};
function normalize(input) {
	return input.replace(/[−–]/g, "-").replace(/[×·∙]/g, "*").replace(/÷/g, "/").replace(/π/g, "pi").replace(/√/g, "sqrt").replace(/²/g, "^2").replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=\s*/i, "").trim();
}
function tokenize(src) {
	const toks = [];
	let i = 0;
	while (i < src.length) {
		const ch = src[i];
		if (ch === " " || ch === "	") {
			i++;
			continue;
		}
		if (/[0-9.]/.test(ch)) {
			const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
			if (!m) throw new ExprError(`A lone "." isn't a number`, i);
			toks.push({
				t: "num",
				v: Number(m[1]),
				pos: i
			});
			i += m[1].length;
			if (src[i] === ".") throw new ExprError("A number can only have one decimal point", i);
			continue;
		}
		if (/[a-z]/i.test(ch)) {
			const run = /^[a-z]+/i.exec(src.slice(i))[0].toLowerCase();
			let j = 0;
			while (j < run.length) {
				const name = NAMES.find((n) => run.startsWith(n, j));
				if (!name) throw new ExprError(`Unknown name "${run.slice(j)}". Use x, pi, e, or sin cos tan ln log sqrt abs exp, or |x|`, i + j);
				toks.push({
					t: "name",
					v: name,
					pos: i + j
				});
				j += name.length;
			}
			i += run.length;
			continue;
		}
		if ("+-*/^".includes(ch)) {
			toks.push({
				t: "op",
				v: ch,
				pos: i
			});
			i++;
			continue;
		}
		if (ch === "(" || ch === ")" || ch === "|") {
			toks.push({
				t: ch,
				pos: i
			});
			i++;
			continue;
		}
		if (ch === "[" || ch === "{") throw new ExprError("Use round brackets ( ) for grouping", i);
		throw new ExprError(`"${ch}" isn't allowed in an equation`, i);
	}
	return toks;
}
var Parser = class {
	toks;
	len;
	i = 0;
	depth = 0;
	/** Inside |…|, a "|" closes the bars instead of starting an implicit product. */
	bars = 0;
	constructor(toks, len) {
		this.toks = toks;
		this.len = len;
	}
	parse() {
		if (this.toks.length === 0) throw new ExprError("Type an equation, for example 0.5x", 0);
		const n = this.expr();
		const t = this.peek();
		if (t) {
			if (t.t === ")") throw new ExprError("There is a \")\" without a matching \"(\"", t.pos);
			throw new ExprError("Unexpected symbol here", t.pos);
		}
		return n;
	}
	peek() {
		return this.toks[this.i];
	}
	enter(pos) {
		if (++this.depth > MAX_DEPTH$1) throw new ExprError("Equation is nested too deeply", pos);
	}
	expr() {
		let n = this.term();
		for (let t = this.peek(); t && t.t === "op" && (t.v === "+" || t.v === "-"); t = this.peek()) {
			this.i++;
			n = {
				k: "bin",
				op: t.v,
				a: n,
				b: this.term()
			};
		}
		return n;
	}
	term() {
		let n = this.unary();
		for (;;) {
			const t = this.peek();
			if (t && t.t === "op" && (t.v === "*" || t.v === "/")) {
				this.i++;
				n = {
					k: "bin",
					op: t.v,
					a: n,
					b: this.unary()
				};
			} else if (t && (t.t === "num" || t.t === "name" || t.t === "(" || t.t === "|" && this.bars === 0)) {
				if (t.t === "num" && n.k !== "num" && this.prevIsName()) throw new ExprError("Put the number before the letter, like 2x not x2", t.pos);
				n = {
					k: "bin",
					op: "*",
					a: n,
					b: this.unary()
				};
			} else return n;
		}
	}
	prevIsName() {
		return this.toks[this.i - 1]?.t === "name";
	}
	unary() {
		const t = this.peek();
		if (t && t.t === "op" && (t.v === "-" || t.v === "+")) {
			this.i++;
			this.enter(t.pos);
			const a = this.unary();
			this.depth--;
			return t.v === "-" ? {
				k: "neg",
				a
			} : a;
		}
		return this.power();
	}
	power() {
		const base = this.primary();
		const t = this.peek();
		if (t && t.t === "op" && t.v === "^") {
			this.i++;
			this.enter(t.pos);
			const exp = this.unary();
			this.depth--;
			return {
				k: "bin",
				op: "^",
				a: base,
				b: exp
			};
		}
		return base;
	}
	primary() {
		const t = this.peek();
		if (!t) throw new ExprError("The equation ends too early", this.len);
		if (t.t === "num") {
			this.i++;
			return {
				k: "num",
				v: t.v
			};
		}
		if (t.t === "(") {
			this.i++;
			this.enter(t.pos);
			const n = this.expr();
			this.depth--;
			if (this.peek()?.t !== ")") throw new ExprError("Missing \")\"", t.pos);
			this.i++;
			return n;
		}
		if (t.t === "name") {
			this.i++;
			if (t.v === "x") return { k: "x" };
			if (t.v in CONSTS) return {
				k: "num",
				v: CONSTS[t.v]
			};
			const f = t.v;
			if (this.peek()?.t !== "(") throw new ExprError(`Use brackets after ${f}, like ${f}(x)`, t.pos);
			this.i++;
			this.enter(t.pos);
			const a = this.expr();
			this.depth--;
			if (this.peek()?.t !== ")") throw new ExprError(`Missing ")" after ${f}(`, t.pos);
			this.i++;
			return {
				k: "call",
				f,
				a
			};
		}
		if (t.t === "|") {
			this.i++;
			this.enter(t.pos);
			this.bars++;
			const a = this.expr();
			this.bars--;
			this.depth--;
			if (this.peek()?.t !== "|") throw new ExprError("Missing the closing \"|\"", t.pos);
			this.i++;
			return {
				k: "call",
				f: "abs",
				a
			};
		}
		if (t.t === ")") throw new ExprError("Something is missing before \")\"", t.pos);
		throw new ExprError(`"${t.t === "op" ? t.v : t.t}" needs something on its left`, t.pos);
	}
};
function compileNode(n) {
	switch (n.k) {
		case "num": {
			const v = n.v;
			return () => v;
		}
		case "x": return (x) => x;
		case "neg": {
			const a = compileNode(n.a);
			return (x) => -a(x);
		}
		case "call": {
			const f = FUNCS[n.f];
			const a = compileNode(n.a);
			return (x) => f(a(x));
		}
		case "bin": {
			const a = compileNode(n.a);
			const b = compileNode(n.b);
			switch (n.op) {
				case "+": return (x) => a(x) + b(x);
				case "-": return (x) => a(x) - b(x);
				case "*": return (x) => a(x) * b(x);
				case "/": return (x) => a(x) / b(x);
				case "^": return (x) => Math.pow(a(x), b(x));
			}
		}
	}
}
function compile(input) {
	if (input.length > 120) return {
		ok: false,
		error: `Keep equations under 120 characters`,
		pos: 120
	};
	try {
		const src = normalize(input);
		const ast = new Parser(tokenize(src), src.length).parse();
		return {
			ok: true,
			ast,
			fn: compileNode(ast),
			family: classify(ast)
		};
	} catch (e) {
		if (e instanceof ExprError) return {
			ok: false,
			error: e.message,
			pos: e.pos
		};
		throw e;
	}
}
function calls(n, out) {
	if (n.k === "call") {
		if (hasX(n.a)) out.add(n.f);
		calls(n.a, out);
	} else if (n.k === "neg") calls(n.a, out);
	else if (n.k === "bin") {
		calls(n.a, out);
		calls(n.b, out);
	}
	return out;
}
function hasX(n) {
	if (n.k === "x") return true;
	if (n.k === "num") return false;
	if (n.k === "bin") return hasX(n.a) || hasX(n.b);
	return hasX(n.a);
}
/** Some power has x in its exponent: 2^x, e^(0.1x). */
function growsExponentially(n) {
	if (n.k === "bin") return n.op === "^" && hasX(n.b) || growsExponentially(n.a) || growsExponentially(n.b);
	if (n.k === "neg" || n.k === "call") return growsExponentially(n.a);
	return false;
}
/** Polynomial degree in x, or null when the expression isn't a polynomial. */
function degree(n) {
	switch (n.k) {
		case "num": return 0;
		case "x": return 1;
		case "neg": return degree(n.a);
		case "call": return degree(n.a) === 0 ? 0 : null;
		case "bin": {
			const a = degree(n.a);
			const b = degree(n.b);
			if (a === null || b === null) return null;
			if (n.op === "+" || n.op === "-") return Math.max(a, b);
			if (n.op === "*") return a + b;
			if (n.op === "/") return b === 0 ? a : null;
			if (b !== 0) return null;
			if (a === 0) return 0;
			const e = compileNode(n.b)(0);
			return Number.isInteger(e) && e >= 0 ? a * e : null;
		}
	}
}
function classify(ast) {
	const used = calls(ast, /* @__PURE__ */ new Set());
	if (used.has("tan")) return "tangent";
	if (used.has("ln") || used.has("log")) return "log";
	if (used.has("sin") || used.has("cos")) return "sine";
	if (used.has("exp") || growsExponentially(ast)) return "exponential";
	if (used.has("sqrt")) return "sqrt";
	if (used.has("abs")) return "absolute";
	const d = degree(ast);
	if (d === 0) return "constant";
	if (d === 1) return "linear";
	if (d === 2) return "quadratic";
	if (d === 3) return "cubic";
	return "other";
}
// src/net/look.ts
/**
* Cosmetics: how a player looks and what their shots look like. Everything is
* free. Shared by client and server; looks from other players are untrusted, so
* parseLook only ever returns ids from these lists.
*/
var COLORS = [
	{
		id: "#f0483e",
		name: "Red"
	},
	{
		id: "#2f7cf6",
		name: "Blue"
	},
	{
		id: "#22b35e",
		name: "Green"
	},
	{
		id: "#8b5cf6",
		name: "Purple"
	},
	{
		id: "#ff8a1f",
		name: "Orange"
	},
	{
		id: "#ff4f9a",
		name: "Pink"
	},
	{
		id: "#14b8a6",
		name: "Teal"
	},
	{
		id: "#eab308",
		name: "Gold"
	},
	{
		id: "#0ea5e9",
		name: "Sky"
	},
	{
		id: "#84cc16",
		name: "Lime"
	},
	{
		id: "#a0522d",
		name: "Cocoa"
	},
	{
		id: "#64748b",
		name: "Slate"
	}
];
var FACES = [
	{
		id: "classic",
		name: "Classic"
	},
	{
		id: "shades",
		name: "Cool shades"
	},
	{
		id: "nerd",
		name: "Big glasses"
	},
	{
		id: "cyclops",
		name: "Cyclops"
	},
	{
		id: "robot",
		name: "Robot"
	},
	{
		id: "sleepy",
		name: "Sleepy"
	},
	{
		id: "starry",
		name: "Star eyes"
	},
	{
		id: "cat",
		name: "Kitty"
	}
];
var HATS = [
	{
		id: "none",
		name: "No hat"
	},
	{
		id: "crown",
		name: "Crown"
	},
	{
		id: "party",
		name: "Party hat"
	},
	{
		id: "tophat",
		name: "Top hat"
	},
	{
		id: "wizard",
		name: "Wizard"
	},
	{
		id: "propeller",
		name: "Propeller cap"
	},
	{
		id: "ears",
		name: "Cat ears"
	},
	{
		id: "halo",
		name: "Halo"
	},
	{
		id: "chef",
		name: "Chef"
	},
	{
		id: "viking",
		name: "Viking"
	},
	{
		id: "sprout",
		name: "Sprout"
	},
	{
		id: "bow",
		name: "Bow"
	}
];
var SHOTS = [
	{
		id: "classic",
		name: "Classic"
	},
	{
		id: "rocket",
		name: "Rocket"
	},
	{
		id: "spaghetti",
		name: "Spaghetti rocket"
	},
	{
		id: "rainbow",
		name: "Rainbow"
	},
	{
		id: "comet",
		name: "Fire comet"
	},
	{
		id: "bubbles",
		name: "Bubbles"
	},
	{
		id: "stars",
		name: "Star trail"
	},
	{
		id: "lightning",
		name: "Lightning"
	},
	{
		id: "plane",
		name: "Paper plane"
	}
];
/** Seat colors double as defaults, so players who never visit the locker still differ. */
var SEAT_COLORS = [
	"#f0483e",
	"#2f7cf6",
	"#22b35e",
	"#8b5cf6",
	"#ff8a1f",
	"#ff4f9a"
];
var defaultLook = (seat = 1) => ({
	color: SEAT_COLORS[seat % SEAT_COLORS.length],
	face: "classic",
	hat: "none",
	shot: "classic"
});
var pick = (list, v, fallback) => list.find((o) => o.id === v)?.id ?? fallback;
function parseLook(v, seat = 1) {
	const d = defaultLook(seat);
	if (typeof v !== "object" || v === null) return d;
	const o = v;
	return {
		color: pick(COLORS, o.color, d.color),
		face: pick(FACES, o.face, d.face),
		hat: pick(HATS, o.hat, d.hat),
		shot: pick(SHOTS, o.shot, d.shot)
	};
}
/** Keep colors distinct in one match: a taken color falls back to the first free one. */
function uniqueColor(want, taken) {
	if (!taken.includes(want)) return want;
	return [...SEAT_COLORS, ...COLORS.map((c) => c.id)].find((c) => !taken.includes(c)) ?? want;
}
// src/net/protocol.ts
var CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** Strip control characters and trim; empty names get a seat name later. */
function cleanName(v) {
	if (typeof v !== "string") return "";
	const bad = (c) => c < 32 || c >= 127 && c <= 159 || c >= 8203 && c <= 8207 || c >= 8232 && c <= 8238;
	return [...v].filter((ch) => !bad(ch.codePointAt(0) ?? 0)).join("").trim().slice(0, 16);
}
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
/** Validate an untrusted client message. Returns null for anything malformed. */
function parseClientMsg(raw) {
	if (!isObj(raw) || typeof raw.t !== "string") return null;
	switch (raw.t) {
		case "create": {
			const lives = typeof raw.lives === "number" && [
				1,
				2,
				3
			].includes(raw.lives) ? raw.lives : 1;
			return {
				t: "create",
				name: cleanName(raw.name),
				lives,
				look: parseLook(raw.look)
			};
		}
		case "join": {
			if (typeof raw.code !== "string") return null;
			const code = raw.code.toUpperCase().trim();
			if (code.length !== 5 || [...code].some((c) => !"ABCDEFGHJKMNPQRSTUVWXYZ23456789".includes(c))) return null;
			return {
				t: "join",
				code,
				name: cleanName(raw.name),
				look: parseLook(raw.look)
			};
		}
		case "quick": return {
			t: "quick",
			name: cleanName(raw.name),
			look: parseLook(raw.look)
		};
		case "start":
		case "leave": return { t: raw.t };
		case "resume":
			if (typeof raw.id !== "string" || !/^[0-9a-f-]{36}$/.test(raw.id)) return null;
			if (typeof raw.key !== "string" || !/^[0-9a-f]{32}$/.test(raw.key)) return null;
			return {
				t: "resume",
				id: raw.id,
				key: raw.key
			};
		case "lock": {
			if (typeof raw.expr !== "string" || raw.expr.length > 120) return null;
			if (raw.facing !== 1 && raw.facing !== -1) return null;
			const msg = {
				t: "lock",
				expr: raw.expr,
				facing: raw.facing
			};
			if (raw.power === true) msg.power = true;
			if (raw.to !== void 0) {
				if (!isObj(raw.to) || typeof raw.to.x !== "number" || typeof raw.to.y !== "number" || !Number.isFinite(raw.to.x) || !Number.isFinite(raw.to.y)) return null;
				msg.to = {
					x: raw.to.x,
					y: raw.to.y
				};
			}
			return msg;
		}
		default: return null;
	}
}
function publicGame(g) {
	const { locks: _locks, ...rest } = g;
	return rest;
}
// src/engine/trajectory.ts
var MAX_DEPTH = 22;
var MAX_POINTS = 2e5;
/**
* Shots live in the shooter's local frame: x is distance in front of the shooter,
* y is height relative to them. The curve is anchored to the shooter, so the
* world path is (origin.x + facing·x, origin.y + f(x) − f(0)) for x ≥ 0.
*/
function computePath(fn, origin, facing, bounds) {
	const y0 = fn(0);
	if (!Number.isFinite(y0)) return {
		ok: false,
		error: "Your curve isn't defined at x = 0, where you stand. Shift it so it exists at your position."
	};
	const g = (x) => fn(x) - y0;
	const width = bounds.maxX - bounds.minX;
	const STEP = width / 2e3;
	const MAX_SEG = width / 800;
	/** A jump this large between neighbours that can't be refined is a discontinuity. */
	const JUMP = width / 80;
	const pts = [origin.x, origin.y];
	let lastWx = origin.x;
	let lastWy = origin.y;
	const emit = (x, y) => {
		const wx = origin.x + facing * x;
		const wy = origin.y + y;
		if (wx < bounds.minX || wx > bounds.maxX || wy < bounds.minY || wy > bounds.maxY) {
			const t = clipT(lastWx, lastWy, wx, wy, bounds);
			pts.push(lastWx + (wx - lastWx) * t, lastWy + (wy - lastWy) * t);
			return true;
		}
		pts.push(wx, wy);
		lastWx = wx;
		lastWy = wy;
		return false;
	};
	const seg = (x0, y0s, x1, y1, depth) => {
		const bad = !Number.isFinite(y1);
		if (bad || Math.hypot(x1 - x0, y1 - y0s) > MAX_SEG) {
			if (depth >= MAX_DEPTH) {
				if (bad) return "undefined";
				if (Math.abs(y1 - y0s) > JUMP) return "asymptote";
				return emit(x1, y1) ? "bounds" : null;
			}
			const xm = (x0 + x1) / 2;
			const ym = g(xm);
			return seg(x0, y0s, xm, ym, depth + 1) ?? seg(xm, ym, x1, y1, depth + 1);
		}
		return emit(x1, y1) ? "bounds" : null;
	};
	const maxRange = bounds.maxX - bounds.minX + 1;
	let x = 0;
	let y = 0;
	for (let i = 1; x < maxRange; i++) {
		const nx = Math.min(i * STEP, maxRange);
		const ny = g(nx);
		const end = seg(x, y, nx, ny, 0);
		if (end) return {
			ok: true,
			pts,
			end
		};
		if (pts.length > MAX_POINTS) return {
			ok: true,
			pts,
			end: "range"
		};
		x = nx;
		y = ny;
	}
	return {
		ok: true,
		pts,
		end: "range"
	};
}
function clipT(ax, ay, bx, by, b) {
	let t = 1;
	const dx = bx - ax;
	const dy = by - ay;
	if (bx < b.minX) t = Math.min(t, (b.minX - ax) / dx);
	if (bx > b.maxX) t = Math.min(t, (b.maxX - ax) / dx);
	if (by < b.minY) t = Math.min(t, (b.minY - ay) / dy);
	if (by > b.maxY) t = Math.min(t, (b.maxY - ay) / dy);
	return Math.max(0, t);
}
/** Thin a dense path for drawing or the network, keeping both endpoints. */
function decimate(pts, minGap = .08) {
	if (pts.length <= 4) return pts.slice();
	const out = [pts[0], pts[1]];
	let lx = pts[0];
	let ly = pts[1];
	for (let i = 2; i < pts.length - 2; i += 2) if (Math.hypot(pts[i] - lx, pts[i + 1] - ly) >= minGap) {
		out.push(pts[i], pts[i + 1]);
		lx = pts[i];
		ly = pts[i + 1];
	}
	out.push(pts[pts.length - 2], pts[pts.length - 1]);
	return out;
}
// src/engine/geometry.ts
function shapeAabb(s) {
	if (s.kind === "circle") return {
		minX: s.x - s.r,
		minY: s.y - s.r,
		maxX: s.x + s.r,
		maxY: s.y + s.r
	};
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of s.pts) {
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x);
		maxY = Math.max(maxY, p.y);
	}
	return {
		minX,
		minY,
		maxX,
		maxY
	};
}
/** Earliest t in [0,1] where segment a→b touches the circle, or -1. */
function segCircle(ax, ay, bx, by, cx, cy, r) {
	const fx = ax - cx;
	const fy = ay - cy;
	const c = fx * fx + fy * fy - r * r;
	if (c <= 0) return 0;
	const dx = bx - ax;
	const dy = by - ay;
	const a = dx * dx + dy * dy;
	if (a === 0) return -1;
	const b = 2 * (fx * dx + fy * dy);
	const disc = b * b - 4 * a * c;
	if (disc < 0) return -1;
	const t = (-b - Math.sqrt(disc)) / (2 * a);
	return t >= 0 && t <= 1 ? t : -1;
}
/** t along a→b where it crosses segment c→d, or -1. */
function segSeg(ax, ay, bx, by, cx, cy, dx, dy) {
	const rx = bx - ax;
	const ry = by - ay;
	const sx = dx - cx;
	const sy = dy - cy;
	const den = rx * sy - ry * sx;
	if (den === 0) return -1;
	const qx = cx - ax;
	const qy = cy - ay;
	const t = (qx * sy - qy * sx) / den;
	const u = (qx * ry - qy * rx) / den;
	return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}
function pointInPoly(x, y, pts) {
	let inside = false;
	for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
		const a = pts[i];
		const b = pts[j];
		if (a.y > y !== b.y > y && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
	}
	return inside;
}
function segPoly(ax, ay, bx, by, pts) {
	if (pointInPoly(ax, ay, pts)) return 0;
	let best = -1;
	for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
		const t = segSeg(ax, ay, bx, by, pts[j].x, pts[j].y, pts[i].x, pts[i].y);
		if (t >= 0 && (best < 0 || t < best)) best = t;
	}
	return best;
}
/** Both t in [0,1] where segment a→b crosses the circle's edge. */
function segCircleAll(ax, ay, bx, by, cx, cy, r) {
	const dx = bx - ax;
	const dy = by - ay;
	const fx = ax - cx;
	const fy = ay - cy;
	const a = dx * dx + dy * dy;
	if (a === 0) return [];
	const b = 2 * (fx * dx + fy * dy);
	const c = fx * fx + fy * fy - r * r;
	const disc = b * b - 4 * a * c;
	if (disc < 0) return [];
	const q = Math.sqrt(disc);
	return [(-b - q) / (2 * a), (-b + q) / (2 * a)].filter((t) => t >= 0 && t <= 1);
}
function segShapeAll(ax, ay, bx, by, s) {
	if (s.kind === "circle") return segCircleAll(ax, ay, bx, by, s.x, s.y, s.r);
	const out = [];
	for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) {
		const t = segSeg(ax, ay, bx, by, s.pts[j].x, s.pts[j].y, s.pts[i].x, s.pts[i].y);
		if (t >= 0) out.push(t);
	}
	return out;
}
function pointInShape(x, y, s) {
	return s.kind === "circle" ? (x - s.x) ** 2 + (y - s.y) ** 2 <= s.r * s.r : pointInPoly(x, y, s.pts);
}
var inCrater = (x, y, craters) => craters.some((c) => (x - c.x) ** 2 + (y - c.y) ** 2 < c.r * c.r);
/**
* Earliest t where segment a→b enters the solid part of a shape that has
* craters blasted out of it, or -1. Exact: every crossing of the shape edge
* and of each crater edge is a candidate, checked just past the crossing.
*/
function segShapeCratered(ax, ay, bx, by, s, craters) {
	if (craters.length === 0) return segShape(ax, ay, bx, by, s);
	const solidAt = (t) => {
		const x = ax + (bx - ax) * t;
		const y = ay + (by - ay) * t;
		return pointInShape(x, y, s) && !inCrater(x, y, craters);
	};
	if (solidAt(0)) return 0;
	const ts = [...segShapeAll(ax, ay, bx, by, s), ...craters.flatMap((c) => segCircleAll(ax, ay, bx, by, c.x, c.y, c.r))].sort((p, q) => p - q);
	for (const t of ts) if (solidAt(Math.min(1, t + 1e-7))) return t;
	return -1;
}
/** Is any part of the shape left outside the craters? (Sampled; only used to drop fully blasted obstacles.) */
function shapeHasSolid(s, craters) {
	if (craters.length === 0) return true;
	const b = shapeAabb(s);
	const n = 14;
	for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
		const x = b.minX + (b.maxX - b.minX) * i / n;
		const y = b.minY + (b.maxY - b.minY) * j / n;
		if (pointInShape(x, y, s) && !inCrater(x, y, craters)) return true;
	}
	return false;
}
function segShape(ax, ay, bx, by, s) {
	return s.kind === "circle" ? segCircle(ax, ay, bx, by, s.x, s.y, s.r) : segPoly(ax, ay, bx, by, s.pts);
}
function distToSeg(px, py, ax, ay, bx, by) {
	const dx = bx - ax;
	const dy = by - ay;
	const len = dx * dx + dy * dy;
	const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
/** Distance from a point to the shape's boundary; negative when inside. */
function distToShape(px, py, s) {
	if (s.kind === "circle") return Math.hypot(px - s.x, py - s.y) - s.r;
	let d = Infinity;
	for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) d = Math.min(d, distToSeg(px, py, s.pts[j].x, s.pts[j].y, s.pts[i].x, s.pts[i].y));
	return pointInPoly(px, py, s.pts) ? -d : d;
}
function aabbOverlap(a, minX, minY, maxX, maxY) {
	return a.minX <= maxX && a.maxX >= minX && a.minY <= maxY && a.maxY >= minY;
}
function rectPoly(cx, cy, w, h, angle = 0) {
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	return {
		kind: "poly",
		pts: [
			[-w / 2, -h / 2],
			[w / 2, -h / 2],
			[w / 2, h / 2],
			[-w / 2, h / 2]
		].map(([x, y]) => ({
			x: cx + x * c - y * s,
			y: cy + x * s + y * c
		}))
	};
}
function trianglePoly(cx, cy, size, angle = 0) {
	const pts = [];
	for (let i = 0; i < 3; i++) {
		const a = angle + Math.PI / 2 + i * 2 * Math.PI / 3;
		pts.push({
			x: cx + size * Math.cos(a),
			y: cy + size * Math.sin(a)
		});
	}
	return {
		kind: "poly",
		pts
	};
}
function starPoly(cx, cy, outer, inner, points = 5, angle = 0) {
	const pts = [];
	for (let i = 0; i < points * 2; i++) {
		const r = i % 2 === 0 ? outer : inner;
		const a = angle + Math.PI / 2 + i * Math.PI / points;
		pts.push({
			x: cx + r * Math.cos(a),
			y: cy + r * Math.sin(a)
		});
	}
	return {
		kind: "poly",
		pts
	};
}
// src/engine/rng.ts
/** Deterministic PRNG (mulberry32) so server and clients build identical maps from a seed. */
function rng(seed) {
	let s = seed >>> 0;
	return () => {
		s = s + 1831565813 >>> 0;
		let t = s;
		t = Math.imul(t ^ t >>> 15, t | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
var between = (r, lo, hi) => lo + r() * (hi - lo);
// src/engine/map.ts
/** Battle arena. Practice challenges use the smaller PRACTICE_BOUNDS they were designed on. */
var ARENA_BOUNDS = {
	minX: -100,
	maxX: 100,
	minY: -60,
	maxY: 60
};
var PLAYER_RADIUS = 1.6;
function makeObstacle(id, kind, shape, solid = false) {
	return {
		id,
		kind,
		shape,
		solid: solid || void 0
	};
}
/**
* k = arena width / 40. Positions scale with k; sizes scale faster (sk) so a big
* battle map has a few large obstacles with wide lanes, not many small ones.
*/
function randomObstacle(r, id, b, k) {
	const x = between(r, b.minX + 3 * k, b.maxX - 3 * k);
	const y = between(r, b.minY + 2 * k, b.maxY - 2 * k);
	k = 1 + (k - 1) * 2;
	const pick = r();
	if (pick < .3) return makeObstacle(id, "boulder", {
		kind: "circle",
		x,
		y,
		r: between(r, .8, 2.2) * k
	});
	if (pick < .6) {
		const h = between(r, 2.5, 7) * k;
		return makeObstacle(id, "wall", rectPoly(x, y, between(r, .5, 1) * k, h, r() < .6 ? 0 : r() < .5 ? Math.PI / 2 : between(r, -.5, .5)));
	}
	if (pick < .8) return makeObstacle(id, "triangle", trianglePoly(x, y, between(r, 1, 2) * k, between(r, 0, Math.PI)));
	const outer = between(r, 1, 1.8) * k;
	return makeObstacle(id, "star", starPoly(x, y, outer, outer * .45, 5, between(r, 0, Math.PI)));
}
function obstaclesClear(a, list, gap) {
	const ba = shapeAabb(a.shape);
	return list.every((o) => {
		const bb = shapeAabb(o.shape);
		return ba.maxX + gap < bb.minX || bb.maxX + gap < ba.minX || ba.maxY + gap < bb.minY || bb.maxY + gap < ba.minY;
	});
}
function spawnOk(p, obstacles, spawns, k) {
	return obstacles.every((o) => distToShape(p.x, p.y, o.shape) > 1.6 + .4 * k) && spawns.every((s) => Math.hypot(s.x - p.x, s.y - p.y) > 8 * k);
}
/**
* Random obstacles, then spawns spread across both halves so every player
* has someone in front of them. Retries with a derived seed if spawns don't fit.
*/
function generateMap(seed, players, bounds = ARENA_BOUNDS) {
	for (let attempt = 0; attempt < 50; attempt++) {
		const r = rng(seed + attempt * 7919);
		const k = (bounds.maxX - bounds.minX) / 40;
		const count = Math.round(k > 1 ? between(r, 8, 12) : between(r, 9, 14));
		const obstacles = [];
		for (let tries = 0; obstacles.length < count && tries < 600; tries++) {
			const o = randomObstacle(r, `o${obstacles.length}`, bounds, k);
			const box = shapeAabb(o.shape);
			if (box.minX > bounds.minX + k && box.maxX < bounds.maxX - k && box.minY > bounds.minY + .5 * k && box.maxY < bounds.maxY - .5 * k && obstaclesClear(o, obstacles, k > 1 ? 2.4 * k : 1.2)) obstacles.push(o);
		}
		const spawns = [];
		for (let i = 0; i < players; i++) {
			const side = i % 2 === 0 ? -1 : 1;
			let placed = false;
			for (let tries = 0; tries < 300 && !placed; tries++) {
				const p = {
					x: side * between(r, 6 * k, bounds.maxX - 2 * k),
					y: between(r, bounds.minY + 2 * k, bounds.maxY - 2 * k)
				};
				if (spawnOk(p, obstacles, spawns, k)) {
					spawns.push(p);
					placed = true;
				}
			}
			if (!placed) break;
		}
		if (spawns.length === players) return {
			bounds,
			obstacles,
			spawns
		};
	}
	throw new Error("Could not generate a map");
}
// src/engine/collision.ts
/** Blast radius of a missile: 2.5% of the arena width (5 units on the battle map). */
var craterRadius = (b) => (b.maxX - b.minX) * .025;
/**
* Walks the sampled path segment by segment and stops at the first exact
* segment/shape intersection. The shooter never collides with itself.
*/
function traceShot(arena, shooterId, pts, end, opts = {}) {
	const craters = arena.craters ?? [];
	const obstacles = arena.obstacles.map((o) => ({
		o,
		box: shapeAabb(o.shape)
	}));
	const reach = opts.reach ?? 1;
	const actors = arena.actors.filter((a) => a.id !== shooterId).map((a) => ({
		a,
		r: a.r * reach,
		box: {
			minX: a.x - a.r * reach,
			minY: a.y - a.r * reach,
			maxX: a.x + a.r * reach,
			maxY: a.y + a.r * reach
		}
	}));
	let pierce = opts.pierce ?? 0;
	const drilled = [];
	let length = 0;
	for (let i = 2; i < pts.length; i += 2) {
		const ax = pts[i - 2];
		const ay = pts[i - 1];
		const bx = pts[i];
		const by = pts[i + 1];
		const minX = Math.min(ax, bx);
		const maxX = Math.max(ax, bx);
		const minY = Math.min(ay, by);
		const maxY = Math.max(ay, by);
		let bestT = Infinity;
		let best = null;
		for (const { o, box } of obstacles) {
			if (drilled.includes(o.id) || !aabbOverlap(box, minX, minY, maxX, maxY)) continue;
			const t = o.solid ? segShape(ax, ay, bx, by, o.shape) : segShapeCratered(ax, ay, bx, by, o.shape, craters);
			if (t >= 0 && t < bestT) {
				bestT = t;
				best = {
					type: "obstacle",
					id: o.id
				};
			}
		}
		for (const { a, r, box } of actors) {
			if (!aabbOverlap(box, minX, minY, maxX, maxY)) continue;
			const t = segCircle(ax, ay, bx, by, a.x, a.y, r);
			if (t >= 0 && t < bestT) {
				bestT = t;
				best = {
					type: "actor",
					id: a.id
				};
			}
		}
		if (best?.type === "obstacle" && pierce > 0) {
			pierce--;
			drilled.push(best.id);
			i -= 2;
			continue;
		}
		const segLen = Math.hypot(bx - ax, by - ay);
		if (best) {
			const hx = ax + (bx - ax) * bestT;
			const hy = ay + (by - ay) * bestT;
			return {
				pts: [
					...pts.slice(0, i),
					hx,
					hy
				],
				hit: {
					...best,
					x: hx,
					y: hy
				},
				end: "hit",
				length: length + segLen * bestT,
				...drilled.length ? { drilled } : {}
			};
		}
		length += segLen;
	}
	return {
		pts,
		hit: null,
		end,
		length,
		...drilled.length ? { drilled } : {}
	};
}
// src/engine/shot.ts
/** Parse, build the anchored path from the shooter, and resolve collisions. */
function planShot(arena, shooterId, expr, facing, opts = {}) {
	const shooter = arena.actors.find((a) => a.id === shooterId);
	if (!shooter) return {
		ok: false,
		error: "Shooter is not in the arena"
	};
	if (facing !== 1 && facing !== -1) return {
		ok: false,
		error: "Invalid direction"
	};
	const c = compile(expr);
	if (!c.ok) return {
		ok: false,
		error: c.error
	};
	const path = computePath(c.fn, shooter, facing, arena.bounds);
	if (!path.ok) return {
		ok: false,
		error: path.error
	};
	return {
		ok: true,
		trace: traceShot(arena, shooterId, path.pts, path.end, opts),
		family: c.family,
		fn: c.fn
	};
}
// src/engine/powers.ts
var POWERS = {
	teleport: {
		name: "Teleport",
		text: "Before the shots fly, jump to a new spot nearby. Others aim at where you were.",
		weight: 3,
		color: "#8b5cf6"
	},
	mirror: {
		name: "Mirror Shot",
		text: "Your function fires both ways: in front of you and behind you.",
		weight: 3,
		color: "#2f7cf6"
	},
	first: {
		name: "First Strike",
		text: "Your shot fires before everyone else this round, whenever you lock in.",
		weight: 3,
		color: "#ff8a1f"
	},
	mega: {
		name: "Mega Blast",
		text: "A huge warhead: it hits anyone it passes close to and blasts a double-size hole.",
		weight: 2,
		color: "#f0483e"
	},
	drill: {
		name: "Drill",
		text: "Your shot drills straight through the first obstacle it touches, even metal.",
		weight: 1,
		color: "#6b7489"
	},
	life: {
		name: "Extra Life",
		text: "If you would be knocked out this round, you survive. Used up even if nobody hits you.",
		weight: 1,
		color: "#ff4f9a"
	}
};
var POWER_IDS = Object.keys(POWERS);
/** Everyone gets a new power-up on round 1, then every 2 rounds. */
var spinsAt = (round) => round % 2 === 1;
/** Teleport range: a medium hop, 9% of the arena width (18 units on the battle map). */
var teleportRange = (b) => (b.maxX - b.minX) * .09;
/** Mega Blast hits anything within this many player radii of its path. */
var MEGA_REACH = 2.5;
/** One weighted spin per living player. Seeded, so server and clients agree. */
function spin(seed, round, ids) {
	const r = rng((seed ^ Math.imul(round, 2654435761)) >>> 0);
	const total = POWER_IDS.reduce((s, p) => s + POWERS[p].weight, 0);
	const out = {};
	for (const id of ids) {
		let roll = r() * total;
		out[id] = POWER_IDS.find((p) => (roll -= POWERS[p].weight) < 0) ?? "teleport";
	}
	return out;
}
/** Why a teleport destination is not allowed, or null when it is. */
function teleportError(from, to, radius, bounds, obstacles, others) {
	if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return "Pick a spot on the board";
	if (Math.hypot(to.x - from.x, to.y - from.y) > teleportRange(bounds) + 1e-9) return "Too far: teleport inside the circle";
	if (to.x - radius < bounds.minX || to.x + radius > bounds.maxX || to.y - radius < bounds.minY || to.y + radius > bounds.maxY) return "Stay inside the arena";
	if (obstacles.some((o) => distToShape(to.x, to.y, o.shape) < radius)) return "You can't teleport into an obstacle";
	if (others.some((p) => Math.hypot(p.x - to.x, p.y - to.y) < radius * 2)) return "Someone is already standing there";
	return null;
}
// src/engine/game.ts
var PREP_MS = 6e4;
/**
* How long a shot takes on screen: about 1.3s to cross the arena, and never more
* than 3.5s however long and wiggly the path. Shared so the server can time replays.
*/
function flightSeconds(length, bounds) {
	return Math.min(length / ((bounds.maxX - bounds.minX) * .75), 3.5);
}
var SHOT_PAUSE_MS = 900;
var PASS_PAUSE_MS = 500;
var TELEPORT_PAUSE_MS = 900;
function createGame(setups, seed, opts = {}) {
	if (setups.length < 2 || setups.length > 6) throw new Error("2 to 6 players");
	const lives = Math.max(1, Math.min(3, Math.floor(opts.lives ?? 1)));
	const map = generateMap(seed, setups.length);
	const powers = spin(seed, 1, setups.map((s) => s.id));
	return {
		seed,
		round: 1,
		phase: "prep",
		bounds: map.bounds,
		obstacles: map.obstacles,
		craters: [],
		players: setups.map((s, i) => ({
			id: s.id,
			name: s.name,
			seat: i,
			x: map.spawns[i].x,
			y: map.spawns[i].y,
			lives,
			maxLives: lives,
			alive: true,
			power: powers[s.id]
		})),
		locks: {},
		winnerId: null
	};
}
function toArena(state) {
	return {
		bounds: state.bounds,
		obstacles: state.obstacles,
		craters: state.craters,
		actors: state.players.filter((p) => p.alive).map((p) => ({
			id: p.id,
			x: p.x,
			y: p.y,
			r: PLAYER_RADIUS
		}))
	};
}
function shotOptions(power) {
	if (power === "drill") return { pierce: 1 };
	if (power === "mega") return { reach: MEGA_REACH };
	return {};
}
/** The arena as one player sees it while aiming, standing at `at` (a teleport destination). */
function arenaFrom(state, playerId, at) {
	const arena = toArena(state);
	if (at) arena.actors = arena.actors.map((a) => a.id === playerId ? {
		...a,
		x: at.x,
		y: at.y
	} : a);
	return arena;
}
/** Null when `to` is a legal teleport for this player right now. */
function teleportCheck(state, playerId, to) {
	const p = state.players.find((q) => q.id === playerId);
	if (!p) return "You are not in this round";
	const others = state.players.filter((q) => q.alive && q.id !== playerId);
	return teleportError(p, to, PLAYER_RADIUS, state.bounds, state.obstacles, others);
}
function lockIn(state, playerId, expr, facing, at, use = {}) {
	if (state.phase !== "prep") return {
		ok: false,
		error: "Not accepting shots right now"
	};
	const p = state.players.find((q) => q.id === playerId);
	if (!p || !p.alive) return {
		ok: false,
		error: "You are not in this round"
	};
	if (state.locks[playerId]) return {
		ok: false,
		error: "Already locked in"
	};
	if (!Number.isFinite(at) || at < 0) return {
		ok: false,
		error: "Invalid lock time"
	};
	if (use.power && !p.power) return {
		ok: false,
		error: "You have no power-up to use"
	};
	const power = use.power ? p.power : null;
	let to;
	if (power === "teleport") {
		if (!use.to) return {
			ok: false,
			error: "Click the board to pick where to teleport"
		};
		to = {
			x: use.to.x,
			y: use.to.y
		};
		const err = teleportCheck(state, playerId, to);
		if (err) return {
			ok: false,
			error: err
		};
	}
	const shot = planShot(arenaFrom(state, playerId, to), playerId, expr, facing, shotOptions(power));
	if (!shot.ok) return {
		ok: false,
		error: shot.error
	};
	const lock = {
		expr,
		facing,
		at,
		...power ? { power: true } : {},
		...to ? { to } : {}
	};
	return {
		ok: true,
		state: {
			...state,
			locks: {
				...state.locks,
				[playerId]: lock
			}
		}
	};
}
/** Lock order: First Strike users, then earliest lock first, ties by seat. Unlocked players pass afterwards. */
function firingOrder(state) {
	const alive = state.players.filter((p) => p.alive);
	const first = (p) => state.locks[p.id]?.power && p.power === "first" ? 0 : 1;
	return [...alive.filter((p) => state.locks[p.id]).sort((a, b) => first(a) - first(b) || state.locks[a.id].at - state.locks[b.id].at || a.seat - b.seat), ...alive.filter((p) => !state.locks[p.id])].map((p) => p.id);
}
function spinFor(state) {
	const got = spin(state.seed, state.round, state.players.filter((p) => p.alive).map((p) => p.id));
	for (const p of state.players) p.power = p.alive ? got[p.id] : null;
}
/**
* Resolve every shot of the round in lock order against the evolving arena:
* obstacles damaged by an earlier shot are weaker for the next, and players
* eliminated before their turn lose their shot.
*/
function resolveRound(state) {
	const next = structuredClone(state);
	const events = [];
	const order = firingOrder(state);
	const player = (id) => next.players.find((p) => p.id === id);
	const used = /* @__PURE__ */ new Map();
	for (const id of order) {
		const p = player(id);
		if (next.locks[id]?.power && p.power) used.set(id, p.power);
	}
	for (const id of order) {
		const to = next.locks[id]?.to;
		if (used.get(id) !== "teleport" || !to || teleportCheck(next, id, to)) continue;
		const p = player(id);
		events.push({
			kind: "teleport",
			playerId: id,
			from: {
				x: p.x,
				y: p.y
			},
			to
		});
		p.x = to.x;
		p.y = to.y;
	}
	const shielded = new Set([...used].filter(([, p]) => p === "life").map(([id]) => id));
	for (const id of order) {
		const shooter = player(id);
		const lock = next.locks[id];
		if (!shooter.alive) {
			events.push({
				kind: "cancelled",
				playerId: id,
				reason: "eliminated"
			});
			continue;
		}
		if (!lock) {
			events.push({
				kind: "pass",
				playerId: id,
				reason: "timeout"
			});
			continue;
		}
		const power = used.get(id);
		(power === "mirror" ? [lock.facing, lock.facing === 1 ? -1 : 1] : [lock.facing]).forEach((facing, n) => {
			const shot = planShot(toArena(next), id, lock.expr, facing, shotOptions(power));
			if (!shot.ok) {
				if (n === 0) events.push({
					kind: "pass",
					playerId: id,
					reason: "timeout"
				});
				return;
			}
			const { trace } = shot;
			const ev = {
				kind: "shot",
				playerId: id,
				expr: lock.expr,
				facing,
				family: shot.family,
				at: lock.at,
				pts: decimate(trace.pts),
				end: trace.end,
				length: trace.length,
				hit: trace.hit,
				...power && n === 0 ? { power } : {},
				...n > 0 ? { mirror: true } : {},
				...trace.drilled ? { drilled: trace.drilled } : {}
			};
			if (trace.hit?.type === "obstacle") {
				if (!next.obstacles.find((q) => q.id === trace.hit.id).solid) {
					ev.crater = {
						x: trace.hit.x,
						y: trace.hit.y,
						r: craterRadius(next.bounds) * (power === "mega" ? 2 : 1)
					};
					next.craters.push(ev.crater);
				}
			} else if (trace.hit?.type === "actor") {
				const victim = player(trace.hit.id);
				if (victim.lives <= 1 && shielded.has(victim.id)) {
					shielded.delete(victim.id);
					ev.saved = true;
				} else victim.lives -= 1;
				ev.livesLeft = victim.lives;
				if (victim.lives <= 0) {
					victim.alive = false;
					ev.eliminated = true;
				}
			}
			events.push(ev);
		});
	}
	for (const id of used.keys()) player(id).power = null;
	next.obstacles = next.obstacles.filter((o) => o.solid || shapeHasSolid(o.shape, next.craters));
	next.locks = {};
	const alive = next.players.filter((p) => p.alive);
	if (alive.length <= 1) {
		next.phase = "over";
		next.winnerId = alive[0]?.id ?? null;
	} else {
		next.round += 1;
		if (spinsAt(next.round)) spinFor(next);
	}
	return {
		state: next,
		events
	};
}
/** How long clients need to replay a round's events, so the server can wait for them. */
function replayDurationMs(events, bounds) {
	return events.reduce((ms, e) => ms + (e.kind === "shot" ? flightSeconds(e.length, bounds) * 1e3 + SHOT_PAUSE_MS : e.kind === "teleport" ? TELEPORT_PAUSE_MS : PASS_PAUSE_MS), 1200);
}
/** Remove a player who left mid-game (online). */
function removePlayer(state, playerId) {
	const next = structuredClone(state);
	const p = next.players.find((q) => q.id === playerId);
	if (p) p.alive = false;
	delete next.locks[playerId];
	const alive = next.players.filter((q) => q.alive);
	if (alive.length <= 1 && next.phase !== "over") {
		next.phase = "over";
		next.winnerId = alive[0]?.id ?? null;
	}
	return next;
}
// server/room.ts
/**
* One match as plain, serializable data. Every change goes through the
* functions below, which never touch timers or sockets: they set `due` for
* the next timed step and queue outgoing messages. That lets the same rules
* run in one Node process (lobby.ts) or across many Vercel instances sharing
* Redis (redis-lobby.ts).
*/
var SEAT_NAMES = [
	"Coral",
	"Cyan",
	"Lime",
	"Amber",
	"Violet",
	"Rose"
];
var BETWEEN_ROUNDS_MS = 1500;
/** Public rooms start this long after the second player joins (or sooner, when full). */
var PUBLIC_COUNTDOWN_MS = 2e4;
/** A dropped connection keeps its seat this long, so a reconnect picks up where it left off. */
var GRACE_MS = 2e4;
var active = (m) => !m.left;
var connected = (s) => s.members.filter((m) => m.connected);
var inGrace = (m) => !m.connected && m.goneAt !== void 0;
function broadcast(s, ctx, msg) {
	ctx.out.push({
		to: connected(s).map((m) => m.id),
		msg
	});
}
function tell(ctx, id, msg) {
	ctx.out.push({
		to: [id],
		msg
	});
}
function roomMsg(s, now) {
	return {
		t: "room",
		code: s.code,
		hostId: s.hostId,
		players: s.members.filter(active).map(({ id, name, seat, connected, look }) => ({
			id,
			name,
			seat,
			connected,
			look
		})),
		lives: s.lives,
		inGame: s.game !== null,
		isPublic: s.isPublic,
		startsInMs: s.due?.kind === "launch" ? Math.max(0, s.due.at - now) : null
	};
}
function roundMsg(s, now) {
	const g = s.game;
	return {
		t: "round",
		game: publicGame(g),
		prepMs: Math.max(0, s.roundStart + PREP_MS - now),
		locks: Object.entries(g.locks).map(([id, l]) => ({
			id,
			at: l.at
		}))
	};
}
function createRoom(code, host, lives, isPublic, ctx) {
	const s = {
		code,
		hostId: host.id,
		lives,
		isPublic,
		open: isPublic,
		members: [],
		game: null,
		roundStart: 0,
		prepOpen: false,
		due: null
	};
	addMember(s, host, ctx);
	return s;
}
function addMember(s, j, ctx) {
	if (s.game) return "That match has already started";
	if (s.members.length >= 6) return "That room is full";
	const used = new Set(s.members.map((m) => m.seat));
	let seat = 0;
	while (used.has(seat)) seat++;
	const want = j.look ?? defaultLook(seat);
	const color = uniqueColor(want.color, s.members.map((m) => m.look.color));
	s.members.push({
		id: j.id,
		name: j.name || SEAT_NAMES[seat],
		seat,
		connected: true,
		look: {
			...want,
			color
		},
		keyHash: j.keyHash,
		sid: j.sid
	});
	if (s.isPublic) updateCountdown(s, ctx);
	broadcastRoom(s, ctx);
	return null;
}
/** Public rooms: start when full, count down once two are here, stop if they drop below two. */
function updateCountdown(s, ctx) {
	if (!s.open) return;
	const here = connected(s).length;
	if (here >= 6) launch(s, ctx);
	else if (here >= 2 && s.due?.kind !== "launch") s.due = {
		at: ctx.now + PUBLIC_COUNTDOWN_MS,
		kind: "launch"
	};
	else if (here < 2 && s.due?.kind === "launch") s.due = null;
}
/** Leave for good: the "Leave" button, or a dropped connection that didn't come back in time. */
function remove(s, id, ctx) {
	const m = s.members.find((q) => q.id === id && active(q));
	if (!m) return;
	if (s.game) {
		m.connected = false;
		m.goneAt = void 0;
		m.left = true;
		s.game = removePlayer(s.game, id);
		if (s.game.phase === "over") finishEarly(s, ctx);
		else maybeEndPrep(s, ctx);
	} else {
		s.members = s.members.filter((q) => q !== m);
		if (s.isPublic) updateCountdown(s, ctx);
	}
	if (s.hostId === id) s.hostId = connected(s)[0]?.id ?? "";
	broadcastRoom(s, ctx);
}
/** The connection dropped. The seat is held for GRACE_MS. */
function drop(s, id, sid, ctx) {
	const m = s.members.find((q) => q.id === id && active(q));
	if (!m || !m.connected || m.sid !== sid) return;
	m.connected = false;
	m.goneAt = ctx.now;
	if (s.isPublic && !s.game) updateCountdown(s, ctx);
	broadcastRoom(s, ctx);
}
/** A reconnecting client proves it is the same player with its resume key. */
function resume(s, id, keyHash, sid, ctx) {
	const m = s.members.find((q) => q.id === id && active(q));
	if (!m || m.keyHash !== keyHash) return "That game is no longer available";
	m.connected = true;
	m.goneAt = void 0;
	m.sid = sid;
	tell(ctx, id, { t: "resumed" });
	if (s.isPublic && !s.game) updateCountdown(s, ctx);
	broadcastRoom(s, ctx);
	if (s.game && s.prepOpen) tell(ctx, id, roundMsg(s, ctx.now));
	return null;
}
function start(s, by, ctx) {
	if (s.isPublic) return "Public games start on their own";
	if (by !== s.hostId) return "Only the host can start";
	if (s.game) return "Already playing";
	if (connected(s).length < 2) return "Need at least 2 players";
	launch(s, ctx);
	return null;
}
function launch(s, ctx) {
	if (s.game) return;
	if (s.due?.kind === "launch") s.due = null;
	s.open = false;
	const players = connected(s);
	if (players.length < 2) return;
	s.members = players;
	s.game = createGame(players.map((m) => ({
		id: m.id,
		name: m.name
	})), randomInt(2 ** 31), { lives: s.lives });
	s.game.players.forEach((p) => p.seat = players.find((m) => m.id === p.id).seat);
	broadcastRoom(s, ctx);
	beginRound(s, ctx);
}
function lock(s, id, expr, facing, use, ctx) {
	if (!s.game || s.game.phase !== "prep" || !s.prepOpen) return "Not accepting shots right now";
	const at = ctx.now - s.roundStart;
	if (at > 6e4) return "Time is up";
	const r = lockIn(s.game, id, expr, facing, at, use);
	if (!r.ok) return r.error;
	s.game = r.state;
	broadcast(s, ctx, {
		t: "locked",
		id,
		at
	});
	maybeEndPrep(s, ctx);
	return null;
}
function beginRound(s, ctx) {
	if (!s.game) return;
	s.roundStart = ctx.now;
	s.prepOpen = true;
	broadcast(s, ctx, {
		t: "round",
		game: publicGame(s.game),
		prepMs: PREP_MS,
		locks: []
	});
	s.due = {
		at: ctx.now + PREP_MS,
		kind: "endPrep"
	};
}
/** Everyone still playing (or reconnecting) has locked in: nobody loses time by resolving now. */
function maybeEndPrep(s, ctx) {
	const g = s.game;
	if (!g || !s.prepOpen) return;
	if (g.players.filter((p) => {
		const m = s.members.find((q) => q.id === p.id);
		return p.alive && !g.locks[p.id] && m && (m.connected || inGrace(m));
	}).length === 0) endPrep(s, ctx);
}
function endPrep(s, ctx) {
	if (!s.game || !s.prepOpen) return;
	s.prepOpen = false;
	const { state, events } = resolveRound(s.game);
	s.game = state;
	const over = state.phase === "over";
	const wait = replayDurationMs(events, state.bounds) + BETWEEN_ROUNDS_MS;
	broadcast(s, ctx, {
		t: "resolve",
		events,
		game: publicGame(state),
		nextInMs: over ? null : wait
	});
	if (over) {
		s.game = null;
		s.members = s.members.filter((m) => m.connected || inGrace(m));
		s.due = {
			at: ctx.now + wait,
			kind: "room"
		};
	} else s.due = {
		at: ctx.now + wait,
		kind: "beginRound"
	};
}
function finishEarly(s, ctx) {
	s.prepOpen = false;
	s.due = null;
	broadcast(s, ctx, {
		t: "resolve",
		events: [],
		game: publicGame(s.game),
		nextInMs: null
	});
	s.game = null;
	s.members = s.members.filter((m) => m.connected || inGrace(m));
}
function broadcastRoom(s, ctx) {
	broadcast(s, ctx, roomMsg(s, ctx.now));
}
/** Run whatever is due: expired reconnect grace, then the scheduled step. Hosts call this before every change. */
function tick(s, ctx) {
	for (const m of [...s.members]) if (inGrace(m) && ctx.now - m.goneAt >= 2e4) remove(s, m.id, ctx);
	const d = s.due;
	if (!d || ctx.now < d.at) return;
	s.due = null;
	if (d.kind === "launch") launch(s, ctx);
	else if (d.kind === "endPrep") endPrep(s, ctx);
	else if (d.kind === "beginRound") beginRound(s, ctx);
	else broadcastRoom(s, ctx);
}
/** When the host should call tick next, or null when nothing is scheduled. */
function wakeAt(s) {
	const times = s.members.filter(inGrace).map((m) => m.goneAt + GRACE_MS);
	if (s.due) times.push(s.due.at);
	return times.length ? Math.min(...times) : null;
}
/** Nobody here and nobody coming back: the room can be thrown away. */
var isEmpty = (s) => s.members.every((m) => !m.connected && !inGrace(m));
// server/socket.ts
var hashKey = (key) => createHash("sha256").update(key).digest("hex");
var MSG_RATE = 10;
var MSG_BURST = 20;
var ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
function originAllowed(req) {
	const origin = req.headers.origin;
	if (!origin) return false;
	if (ALLOWED_ORIGINS.length) return ALLOWED_ORIGINS.includes(origin);
	try {
		const o = new URL(origin);
		const host = req.headers["x-forwarded-host"] ?? req.headers.host;
		return o.host === host || (o.hostname === "localhost" || o.hostname === "127.0.0.1") && process.env.NODE_ENV !== "production";
	} catch {
		return false;
	}
}
/** Accept WebSocket upgrades on `paths`, rate-limit and validate every message, and hand them to the hub in order. */
function serveSockets(server, hub, paths) {
	const wss = new WebSocketServer({
		noServer: true,
		maxPayload: 2048
	});
	server.on("upgrade", (req, socket, head) => {
		let path = "";
		try {
			path = new URL(req.url ?? "/", "http://x").pathname;
		} catch {}
		if (!paths.includes(path) || !originAllowed(req)) {
			socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
			socket.destroy();
			return;
		}
		wss.handleUpgrade(req, socket, head, (ws) => connection(ws));
	});
	function connection(ws) {
		const key = randomBytes(16).toString("hex");
		const conn = {
			id: randomUUID(),
			sid: randomUUID(),
			keyHash: hashKey(key),
			send: (msg) => {
				if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
			}
		};
		let chain = Promise.resolve();
		const run = (fn) => {
			chain = chain.then(fn).catch((e) => {
				console.error("handler error", e instanceof Error ? e.message : "unknown");
				conn.send({
					t: "error",
					msg: "Something went wrong"
				});
			});
		};
		let tokens = MSG_BURST;
		let last = Date.now();
		let strikes = 0;
		conn.send({
			t: "welcome",
			you: conn.id,
			key
		});
		ws.on("message", (data, isBinary) => {
			const now = Date.now();
			tokens = Math.min(MSG_BURST, tokens + (now - last) / 1e3 * MSG_RATE);
			last = now;
			if (tokens < 1) {
				if (++strikes > 50) ws.close(1008, "Too many messages");
				return;
			}
			tokens -= 1;
			if (isBinary) return;
			let raw;
			try {
				raw = JSON.parse(data.toString());
			} catch {
				return;
			}
			const msg = parseClientMsg(raw);
			if (!msg) {
				conn.send({
					t: "error",
					msg: "Malformed message"
				});
				return;
			}
			run(() => hub.handle(conn, msg));
		});
		ws.on("error", () => ws.terminate());
		ws.on("close", () => run(() => hub.disconnect(conn)));
	}
}
// server/lobby.ts
var realClock = {
	now: () => Date.now(),
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: (h) => clearTimeout(h)
};
function newCode() {
	let c = "";
	for (let i = 0; i < 5; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
	return c;
}
var joiner = (conn, name, look) => ({
	id: conn.id,
	name,
	look,
	keyHash: conn.keyHash,
	sid: conn.sid
});
/** Report a rule's refusal to the player who asked. */
function reply(ctx, id, error) {
	if (error) tell(ctx, id, {
		t: "error",
		msg: error
	});
}
// server/redis-lobby.ts
var ROOM_TTL_MS = 72e5;
var LOCK_TTL_MS = 5e3;
var K = {
	room: (code) => `fw:room:${code}`,
	lock: (code) => `fw:lock:${code}`,
	player: (id) => `fw:player:${id}`,
	events: (code) => `fw:events:${code}`,
	public: "fw:public",
	publicLock: "fw:lock:public"
};
/**
* Rooms for many server instances at once (Vercel Functions). Room state lives
* in Redis and is changed under a per-room lock; every change is published, and
* each instance delivers it to the sockets it holds. Any instance holding a
* player of a room keeps a timer for the room's next due step; whichever fires
* first does the work, and the others find nothing due.
*/
var RedisLobby = class {
	store;
	clock;
	/** Player id → socket on this instance. */
	conns = /* @__PURE__ */ new Map();
	/** Player id → room, for sockets on this instance. */
	roomOf = /* @__PURE__ */ new Map();
	timers = /* @__PURE__ */ new Map();
	subscribed = /* @__PURE__ */ new Set();
	constructor(store, clock = realClock) {
		this.store = store;
		this.clock = clock;
	}
	async handle(conn, msg) {
		this.conns.set(conn.id, conn);
		const err = (m) => conn.send({
			t: "error",
			msg: m
		});
		const code = this.roomOf.get(conn.id);
		switch (msg.t) {
			case "create":
				if (code) return err("Leave your current room first");
				await this.open(conn, msg.name, msg.look, msg.lives, false);
				return;
			case "quick":
				if (code) return err("Leave your current room first");
				await this.withLock(K.publicLock, async () => {
					const p = await this.store.get(K.public);
					if (p && await this.enter(conn, p, msg.name, msg.look, true)) return;
					const c = await this.open(conn, msg.name, msg.look, 1, true);
					await this.store.set(K.public, c, ROOM_TTL_MS);
				});
				return;
			case "join":
				if (code) return err("Leave your current room first");
				await this.enter(conn, msg.code, msg.name, msg.look);
				return;
			case "start":
				if (!code) return err("Join a room first");
				if (!await this.op(code, (s, ctx) => reply(ctx, conn.id, start(s, conn.id, ctx)))) this.forget(conn.id);
				return;
			case "lock":
				if (!code) return err("Join a room first");
				if (!await this.op(code, (s, ctx) => reply(ctx, conn.id, lock(s, conn.id, msg.expr, msg.facing, {
					power: msg.power,
					to: msg.to
				}, ctx)))) this.forget(conn.id);
				return;
			case "leave":
				if (!code) return;
				await this.op(code, (s, ctx) => remove(s, conn.id, ctx));
				this.forget(conn.id);
				return;
			case "resume":
				if (!await this.resume(conn, msg.id, msg.key)) conn.send({
					t: "error",
					msg: "That game is no longer available",
					code: "resume"
				});
				return;
		}
	}
	async disconnect(conn) {
		if (this.conns.get(conn.id) !== conn) return;
		this.conns.delete(conn.id);
		const code = this.roomOf.get(conn.id);
		if (!code) return;
		this.forget(conn.id);
		await this.op(code, (s, ctx) => drop(s, conn.id, conn.sid, ctx));
	}
	async resume(conn, id, key) {
		const code = await this.store.get(K.player(id));
		if (!code) return false;
		const raw = await this.store.get(K.room(code));
		const keyHash = hashKey(key);
		if (!raw || !JSON.parse(raw).members.some((m) => m.id === id && m.keyHash === keyHash && !m.left)) return false;
		const prev = this.conns.get(id);
		this.conns.set(id, conn);
		this.roomOf.set(id, code);
		await this.subscribe(code);
		let ok = false;
		await this.op(code, (s, ctx) => ok = !resume(s, id, keyHash, conn.sid, ctx));
		if (!ok) {
			if (prev) this.conns.set(id, prev);
			else this.conns.delete(id);
			this.forget(id);
			return false;
		}
		if (this.conns.get(conn.id) === conn && conn.id !== id) this.conns.delete(conn.id);
		conn.id = id;
		conn.keyHash = keyHash;
		return true;
	}
	/** Open a new room with this socket's player as host. */
	async open(conn, name, look, lives, isPublic) {
		for (;;) {
			const code = newCode();
			this.roomOf.set(conn.id, code);
			await this.subscribe(code);
			const ctx = {
				now: this.clock.now(),
				out: []
			};
			const s = createRoom(code, joiner(conn, name, look), lives, isPublic, ctx);
			if (!await this.store.set(K.room(code), JSON.stringify(s), ROOM_TTL_MS, true)) {
				this.forget(conn.id);
				continue;
			}
			await this.store.set(K.player(conn.id), code, ROOM_TTL_MS);
			await this.publish(code, {
				out: ctx.out,
				wake: wakeAt(s)
			});
			return code;
		}
	}
	/** Join a room. `quiet` skips the error message (quick match falls back to a new room). */
	async enter(conn, code, name, look, quiet = false) {
		this.roomOf.set(conn.id, code);
		await this.subscribe(code);
		let joined = false;
		if (!await this.op(code, (s, ctx) => {
			const e = addMember(s, joiner(conn, name, look), ctx);
			joined = !e;
			if (!joined && !quiet) reply(ctx, conn.id, e);
		}) && !quiet) conn.send({
			t: "error",
			msg: "No room with that code"
		});
		if (!joined) {
			this.forget(conn.id);
			return false;
		}
		await this.store.set(K.player(conn.id), code, ROOM_TTL_MS);
		return true;
	}
	/** Load, catch up, change, save and publish one room under its lock. False when the room doesn't exist. */
	op(code, fn) {
		return this.withLock(K.lock(code), async () => {
			const raw = await this.store.get(K.room(code));
			if (!raw) return false;
			const s = JSON.parse(raw);
			const ctx = {
				now: this.clock.now(),
				out: []
			};
			tick(s, ctx);
			fn(s, ctx);
			const empty = isEmpty(s);
			if (empty) {
				await this.store.del(K.room(code));
				await this.store.delIf(K.public, code);
			} else await this.store.set(K.room(code), JSON.stringify(s), ROOM_TTL_MS);
			await this.publish(code, {
				out: ctx.out,
				wake: empty ? null : wakeAt(s)
			});
			return true;
		});
	}
	async publish(code, env) {
		await this.store.publish(K.events(code), JSON.stringify(env));
		this.schedule(code, env.wake);
	}
	async subscribe(code) {
		if (this.subscribed.has(code)) return;
		this.subscribed.add(code);
		await this.store.subscribe(K.events(code), (raw) => {
			const env = JSON.parse(raw);
			for (const o of env.out) for (const id of o.to) this.conns.get(id)?.send(o.msg);
			this.schedule(code, env.wake);
		});
	}
	hasLocal(code) {
		return [...this.roomOf.values()].includes(code);
	}
	/** This socket's player is no longer in a room here: drop the subscription and timer when nobody else needs them. */
	forget(id) {
		const code = this.roomOf.get(id);
		this.roomOf.delete(id);
		if (!code || this.hasLocal(code)) return;
		this.schedule(code, null);
		this.subscribed.delete(code);
		this.store.unsubscribe(K.events(code)).catch(() => {});
	}
	schedule(code, wake) {
		const t = this.timers.get(code);
		if (t !== void 0) this.clock.clearTimeout(t);
		this.timers.delete(code);
		if (wake === null || !this.hasLocal(code)) return;
		this.timers.set(code, this.clock.setTimeout(() => {
			this.timers.delete(code);
			return this.op(code, () => {}).then(() => {}, (e) => console.error("room tick failed", e instanceof Error ? e.message : "unknown"));
		}, Math.max(0, wake - this.clock.now())));
	}
	async withLock(name, fn) {
		const token = randomUUID();
		for (let tries = 0; !await this.store.set(name, token, LOCK_TTL_MS, true); tries++) {
			if (tries > 200) throw new Error("Room is busy");
			await new Promise((r) => setTimeout(r, 15));
		}
		try {
			return await fn();
		} finally {
			await this.store.delIf(name, token);
		}
	}
};
// server/redis-store.ts
var DEL_IF = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
/** Store over a Redis URL (Upstash's REDIS_URL from the Vercel Marketplace, or any Redis 6+). */
function redisStore(url) {
	const client = createClient({ url });
	const sub = client.duplicate();
	client.on("error", (e) => console.error("redis", e instanceof Error ? e.message : "error"));
	sub.on("error", (e) => console.error("redis sub", e instanceof Error ? e.message : "error"));
	const ready = Promise.all([client.connect(), sub.connect()]);
	return {
		async get(key) {
			await ready;
			const v = await client.get(key);
			return typeof v === "string" ? v : null;
		},
		async set(key, value, ttlMs, onlyIfNew) {
			await ready;
			return await client.set(key, value, {
				expiration: {
					type: "PX",
					value: ttlMs
				},
				...onlyIfNew ? { condition: "NX" } : {}
			}) === "OK";
		},
		async del(key) {
			await ready;
			await client.del(key);
		},
		async delIf(key, value) {
			await ready;
			await client.eval(DEL_IF, {
				keys: [key],
				arguments: [value]
			});
		},
		async publish(channel, message) {
			await ready;
			await client.publish(channel, message);
		},
		async subscribe(channel, fn) {
			await ready;
			await sub.subscribe(channel, (message) => fn(String(message)));
		},
		async unsubscribe(channel) {
			await ready;
			await sub.unsubscribe(channel);
		}
	};
}
// server/vercel-ws.ts
/**
* The online game server as a Vercel Function. Bundled into api/ws.js by
* `npm run build:api`; vercel.json rewrites /ws here. Each function instance
* holds some of the sockets, and rooms are shared through Redis.
*/
var url = process.env.REDIS_URL ?? process.env.KV_URL;
var server = createServer((_req, res) => {
	res.writeHead(url ? 200 : 503, {
		"Content-Type": "text/plain",
		"Cache-Control": "no-store"
	});
	res.end(url ? "ok" : "Online play needs a Redis database: connect one in Vercel (Storage) so REDIS_URL is set.");
});
if (url) serveSockets(server, new RedisLobby(redisStore(url)), ["/ws", "/api/ws"]);
else console.error("REDIS_URL is not set: online play is off");
export { server as default };
