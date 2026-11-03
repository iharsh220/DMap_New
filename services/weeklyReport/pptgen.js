// Builds the weekly report .pptx from templates/weekly-report-template.pptx.
// Node port of "Weekly Report App/pptgen.py" working directly on the OOXML parts (JSZip + xmldom).
//
// Template slide order: 0 cover, 1 highlight, 2 client-work table, 3 initiatives table, 4 notes, 5 thank you
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const imageSize = require('image-size');

const NS = {
    p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
    a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
    r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
    ct: 'http://schemas.openxmlformats.org/package/2006/content-types'
};
const RT = {
    slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
    layout: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
    hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
    image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
};
const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const IMAGE_CT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };

const URL_RE = /(https?:\/\/\S+)/;
const PAGE_BOTTOM_MARGIN = 420000; // EMU kept free above the slide bottom (slide number)
const TEMPLATE = path.join(__dirname, '..', '..', 'templates', 'weekly-report-template.pptx');

// ------------------------------------------------------------ xml helpers
const parseXml = str => new DOMParser().parseFromString(str, 'text/xml');
const serialize = doc => new XMLSerializer().serializeToString(doc);
const kids = (el, ns, name) => Array.from(el.childNodes).filter(n => n.nodeType === 1 && n.namespaceURI === ns && n.localName === name);
const kid = (el, ns, name) => kids(el, ns, name)[0] || null;
const all = (el, ns, name) => Array.from(el.getElementsByTagNameNS(ns, name));
const make = (doc, ns, qname) => doc.createElementNS(ns, qname);
const textOf = el => all(el, NS.a, 't').map(t => t.textContent).join('');
const paragraphs = txBody => kids(txBody, NS.a, 'p');

// path helpers for part names inside the zip
const relsPathOf = part => path.posix.join(path.posix.dirname(part), '_rels', path.posix.basename(part) + '.rels');
const resolveTarget = (part, target) => path.posix.normalize(path.posix.join(path.posix.dirname(part), target));

class Rels {
    constructor(xml) {
        this.list = [];
        if (xml) {
            const doc = parseXml(xml);
            all(doc.documentElement, NS.rel, 'Relationship').forEach(r => this.list.push({
                Id: r.getAttribute('Id'), Type: r.getAttribute('Type'), Target: r.getAttribute('Target'), TargetMode: r.getAttribute('TargetMode') || null
            }));
        }
    }
    add(Type, Target, external) {
        let n = 1;
        while (this.list.some(r => r.Id === 'rId' + n)) n++;
        const Id = 'rId' + n;
        this.list.push({ Id, Type, Target, TargetMode: external ? 'External' : null });
        return Id;
    }
    toXml() {
        const esc = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="' + NS.rel + '">'
            + this.list.map(r => `<Relationship Id="${esc(r.Id)}" Type="${esc(r.Type)}" Target="${esc(r.Target)}"${r.TargetMode ? ` TargetMode="${r.TargetMode}"` : ''}/>`).join('')
            + '</Relationships>';
    }
}

// ------------------------------------------------------------ package
class Deck {
    static async load(file) {
        const d = new Deck();
        d.zip = await JSZip.loadAsync(fs.readFileSync(file));
        d.ct = parseXml(await d.zip.file('[Content_Types].xml').async('string'));
        d.pres = parseXml(await d.zip.file('ppt/presentation.xml').async('string'));
        d.presRels = new Rels(await d.zip.file('ppt/_rels/presentation.xml.rels').async('string'));
        const sz = kid(d.pres.documentElement, NS.p, 'sldSz');
        d.width = +sz.getAttribute('cx');
        d.height = +sz.getAttribute('cy');
        d.slides = [];
        const lst = kid(d.pres.documentElement, NS.p, 'sldIdLst');
        for (const sid of kids(lst, NS.p, 'sldId')) {
            const rel = d.presRels.list.find(r => r.Id === sid.getAttributeNS(NS.r, 'id'));
            const part = resolveTarget('ppt/presentation.xml', rel.Target);
            const relsFile = d.zip.file(relsPathOf(part));
            d.slides.push({
                part,
                doc: parseXml(await d.zip.file(part).async('string')),
                rels: new Rels(relsFile ? await relsFile.async('string') : null)
            });
        }
        return d;
    }

    // Copy of a slide (all shapes), keeping only its layout relationship like python-pptx's duplicate
    duplicate(src) {
        let n = 1;
        const used = new Set(Object.keys(this.zip.files).concat(this.slides.map(s => s.part)));
        while (used.has(`ppt/slides/slide${n}.xml`)) n++;
        const rels = new Rels(null);
        const layout = src.rels.list.find(r => r.Type === RT.layout);
        rels.list.push({ ...layout, Id: 'rId1' });
        const doc = parseXml(serialize(src.doc));
        // the copied shapes may point at relationships of the source slide (hyperlinks): drop those links
        all(doc.documentElement, NS.a, 'hlinkClick').forEach(h => h.parentNode.removeChild(h));
        const slide = { part: `ppt/slides/slide${n}.xml`, doc, rels, isNew: true };
        this.slides.push(slide);
        this.zip.file(slide.part, ''); // reserve the name
        return slide;
    }

    addImage(slide, file) {
        const ext = path.extname(file).slice(1).toLowerCase();
        let n = 1;
        while (this.zip.file(`ppt/media/hl${n}.${ext}`)) n++;
        const part = `ppt/media/hl${n}.${ext}`;
        this.zip.file(part, fs.readFileSync(file));
        this.ensureDefault(ext, IMAGE_CT[ext]);
        return slide.rels.add(RT.image, '../media/' + path.posix.basename(part));
    }

    ensureDefault(ext, type) {
        const root = this.ct.documentElement;
        if (kids(root, NS.ct, 'Default').some(d => d.getAttribute('Extension').toLowerCase() === ext)) return;
        const el = make(this.ct, NS.ct, 'Default');
        el.setAttribute('Extension', ext);
        el.setAttribute('ContentType', type);
        root.insertBefore(el, root.firstChild);
    }

    // Write the slides in `order`; every other slide and every part no longer reachable is dropped
    async save(order) {
        const pres = this.pres.documentElement;
        const lst = kid(pres, NS.p, 'sldIdLst');
        const oldIds = kids(lst, NS.p, 'sldId').map(s => +s.getAttribute('id'));
        kids(lst, NS.p, 'sldId').forEach(s => lst.removeChild(s));
        this.presRels.list = this.presRels.list.filter(r => r.Type !== RT.slide);
        let nextId = Math.max(255, ...oldIds) + 1;
        const ctRoot = this.ct.documentElement;
        kids(ctRoot, NS.ct, 'Override').filter(o => o.getAttribute('ContentType') === SLIDE_CT).forEach(o => ctRoot.removeChild(o));

        for (const slide of order) {
            const rId = this.presRels.add(RT.slide, path.posix.relative('ppt', slide.part));
            const sid = make(this.pres, NS.p, 'p:sldId');
            sid.setAttribute('id', String(nextId++));
            sid.setAttributeNS(NS.r, 'r:id', rId);
            lst.appendChild(sid);
            this.zip.file(slide.part, serialize(slide.doc));
            this.zip.file(relsPathOf(slide.part), slide.rels.toXml());
            const o = make(this.ct, NS.ct, 'Override');
            o.setAttribute('PartName', '/' + slide.part);
            o.setAttribute('ContentType', SLIDE_CT);
            ctRoot.appendChild(o);
        }
        this.zip.file('ppt/presentation.xml', serialize(this.pres));
        this.zip.file('ppt/_rels/presentation.xml.rels', this.presRels.toXml());
        await this.prune();
        this.zip.file('[Content_Types].xml', serialize(this.ct));
        // JSZip adds folder entries for new files; PowerPoint packages have none
        Object.keys(this.zip.files).filter(k => this.zip.files[k].dir).forEach(k => { delete this.zip.files[k]; });
        return this.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    }

    // Remove parts nobody points to any more (unused prototype slides and their notes)
    async prune() {
        const reachable = new Set();
        const walk = async (relsFile, base) => {
            const f = this.zip.file(relsFile);
            if (!f) return;
            for (const r of new Rels(await f.async('string')).list) {
                if (r.TargetMode === 'External') continue;
                const part = base === '' ? r.Target.replace(/^\//, '') : resolveTarget(base, r.Target);
                if (reachable.has(part)) continue;
                reachable.add(part);
                await walk(relsPathOf(part), part);
            }
        };
        await walk('_rels/.rels', '');
        const ctRoot = this.ct.documentElement;
        for (const name of Object.keys(this.zip.files)) {
            const f = this.zip.files[name];
            if (f.dir || name === '[Content_Types].xml') continue;
            const owner = name.includes('_rels/') ? name.replace(/_rels\/([^/]+)\.rels$/, '$1') : name;
            if (name === '_rels/.rels' || reachable.has(owner)) continue;
            this.zip.remove(name);
            kids(ctRoot, NS.ct, 'Override').filter(o => o.getAttribute('PartName') === '/' + name).forEach(o => ctRoot.removeChild(o));
        }
    }
}

// ------------------------------------------------------------ shape helpers
const spTree = slide => kid(kid(slide.doc.documentElement, NS.p, 'cSld'), NS.p, 'spTree');
const shapes = slide => Array.from(spTree(slide).childNodes).filter(n => n.nodeType === 1 && ['sp', 'graphicFrame', 'pic', 'grpSp', 'cxnSp'].includes(n.localName));
const isPlaceholder = sh => !!all(sh, NS.p, 'ph').length;
const txBodyOf = sh => kid(sh, NS.p, 'txBody');
const xfrmOf = sh => (sh.localName === 'graphicFrame'
    ? kid(sh, NS.p, 'xfrm')
    : (kid(sh, NS.p, 'spPr') ? kid(kid(sh, NS.p, 'spPr'), NS.a, 'xfrm') : null));
const geom = sh => {
    const x = xfrmOf(sh);
    if (!x) return { left: 0, top: 0, width: 0, height: 0 };
    const off = kid(x, NS.a, 'off'), ext = kid(x, NS.a, 'ext');
    return { left: +off.getAttribute('x'), top: +off.getAttribute('y'), width: +ext.getAttribute('cx'), height: +ext.getAttribute('cy'), off, ext };
};
const nextShapeId = slide => 1 + Math.max(0, ...all(slide.doc.documentElement, NS.p, 'cNvPr').map(c => +c.getAttribute('id') || 0));

// Replace text in the first paragraph's first run, keep its formatting
function setTextKeepFormat(p, text) {
    const runs = kids(p, NS.a, 'r');
    if (runs.length) {
        kid(runs[0], NS.a, 't').textContent = text;
        runs.slice(1).forEach(r => p.removeChild(r));
    } else {
        const doc = p.ownerDocument;
        const r = make(doc, NS.a, 'a:r');
        const t = make(doc, NS.a, 'a:t');
        t.textContent = text;
        r.appendChild(t);
        const end = kid(p, NS.a, 'endParaRPr');
        p.insertBefore(r, end);
    }
}
const setShapeText = (sh, text) => setTextKeepFormat(paragraphs(txBodyOf(sh))[0], text);

// Returns { summary, data } table frames (the data table's first cell starts with "Sr")
function findTables(slide) {
    let summary = null, data = null;
    shapes(slide).filter(sh => sh.localName === 'graphicFrame' && all(sh, NS.a, 'tbl').length).forEach(sh => {
        const first = all(sh, NS.a, 'tc')[0];
        if (textOf(first).trim().toLowerCase().startsWith('sr')) data = sh; else summary = sh;
    });
    return { summary, data };
}

// ------------------------------------------------------------ table filling
function cleanRpr(doc, rpr, bold) {
    let el = rpr ? rpr.cloneNode(true) : make(doc, NS.a, 'a:rPr');
    if (el.localName !== 'rPr') {
        const n = make(doc, NS.a, 'a:rPr');
        Array.from(el.attributes).forEach(at => n.setAttribute(at.name, at.value));
        Array.from(el.childNodes).forEach(c => n.appendChild(c.cloneNode(true)));
        el = n;
    }
    el.removeAttribute('err');
    el.removeAttribute('dirty');
    kids(el, NS.a, 'hlinkClick').forEach(h => el.removeChild(h));
    if (bold !== null && bold !== undefined) el.setAttribute('b', bold ? '1' : '0');
    return el;
}

// lines: array of strings. A line ending with ':' is bold. URLs become links.
function setCellLines(slide, tc, lines) {
    const doc = tc.ownerDocument;
    const body = kid(tc, NS.a, 'txBody');
    const ps = paragraphs(body);
    const p0 = ps[0];
    const ppr = kid(p0, NS.a, 'pPr');
    const r0 = kid(p0, NS.a, 'r');
    const rpr = r0 ? kid(r0, NS.a, 'rPr') : kid(p0, NS.a, 'endParaRPr');
    ps.forEach(p => body.removeChild(p));
    (lines.length ? lines : ['']).forEach(line => {
        const p = make(doc, NS.a, 'a:p');
        if (ppr) p.appendChild(ppr.cloneNode(true));
        const bold = line.replace(/\s+$/, '').endsWith(':');
        line.split(URL_RE).filter(Boolean).forEach(part => {
            const r = make(doc, NS.a, 'a:r');
            const rp = cleanRpr(doc, rpr, bold);
            if (new RegExp('^' + URL_RE.source + '$').test(part)) {
                const rid = slide.rels.add(RT.hyperlink, part, true);
                const h = make(doc, NS.a, 'a:hlinkClick');
                h.setAttributeNS(NS.r, 'r:id', rid);
                rp.appendChild(h);
            }
            r.appendChild(rp);
            const t = make(doc, NS.a, 'a:t');
            t.textContent = part;
            r.appendChild(t);
            p.appendChild(r);
        });
        if (p.childNodes.length === (ppr ? 1 : 0)) { // empty line
            const r = make(doc, NS.a, 'a:r');
            r.appendChild(cleanRpr(doc, rpr, false));
            const t = make(doc, NS.a, 'a:t');
            t.textContent = '';
            r.appendChild(t);
            p.appendChild(r);
        }
        body.appendChild(p);
    });
}

const fontPt = (tc, def = 10.0) => {
    const rpr = all(tc, NS.a, 'rPr')[0];
    return rpr && rpr.getAttribute('sz') ? +rpr.getAttribute('sz') / 100 : def;
};

function estimateRowHeight(tr, colWidths, cellsLines) {
    let best = 0;
    kids(tr, NS.a, 'tc').forEach((tc, i) => {
        if (i >= colWidths.length || i >= cellsLines.length) return;
        const pr = kid(tc, NS.a, 'tcPr');
        const m = (k, d) => (pr && pr.getAttribute(k) ? +pr.getAttribute(k) : d);
        const ml = m('marL', 91440), mr = m('marR', 91440), mt = m('marT', 45720), mb = m('marB', 45720);
        const size = fontPt(tc);
        const usablePt = Math.max(10, (colWidths[i] - ml - mr) / 12700);
        const cpl = Math.max(4, Math.trunc(usablePt / (size * 0.52)));
        let n = 0;
        (cellsLines[i] && cellsLines[i].length ? cellsLines[i] : ['']).forEach(ln => { n += ln ? Math.max(1, Math.ceil(ln.length / cpl)) : 1; });
        best = Math.max(best, Math.trunc(n * size * 1.22 * 12700) + mt + mb);
    });
    return Math.max(best, 230000);
}

const tableOf = frame => all(frame, NS.a, 'tbl')[0];

// Split rows into pages that fit under the data table's top on the slide
function paginate(frame, rowsLines, slideHeight) {
    const tbl = tableOf(frame);
    const trs = kids(tbl, NS.a, 'tr');
    const headerH = +trs[0].getAttribute('h');
    const widths = kids(kid(tbl, NS.a, 'tblGrid'), NS.a, 'gridCol').map(g => +g.getAttribute('w'));
    const avail = slideHeight - PAGE_BOTTOM_MARGIN - geom(frame).top - headerH;
    const pages = [];
    let cur = [], used = 0;
    rowsLines.forEach(lines => {
        const h = estimateRowHeight(trs[1], widths, lines);
        if (cur.length && used + h > avail) { pages.push(cur); cur = []; used = 0; }
        cur.push([lines, h]);
        used += h;
    });
    if (cur.length) pages.push(cur);
    return pages;
}

function fillDataTable(slide, frame, page) {
    const tbl = tableOf(frame);
    const trs = kids(tbl, NS.a, 'tr');
    const [header, tmpl] = trs;
    trs.slice(1).forEach(tr => tbl.removeChild(tr));
    let total = +header.getAttribute('h');
    page.forEach(([lines, h]) => {
        const tr = tmpl.cloneNode(true);
        tr.setAttribute('h', String(h));
        kids(tr, NS.a, 'tc').forEach((tc, i) => { if (i < lines.length) setCellLines(slide, tc, lines[i]); });
        tbl.appendChild(tr);
        total += h;
    });
    geom(frame).ext.setAttribute('cy', String(total));
}

const cellParagraph = (frame, row, col) => {
    const tr = kids(tableOf(frame), NS.a, 'tr')[row];
    return paragraphs(kid(kids(tr, NS.a, 'tc')[col], NS.a, 'txBody'))[0];
};

function fillSummary(frame, counts) {
    counts.forEach((v, i) => setTextKeepFormat(cellParagraph(frame, 1, i + 1), String(v).padStart(2, '0')));
}

// Header cells renamed for task-wise reports (the template is written for projects)
function renameHeaders(frame, names) {
    const tr = kids(tableOf(frame), NS.a, 'tr')[0];
    kids(tr, NS.a, 'tc').forEach(tc => {
        const p = paragraphs(kid(tc, NS.a, 'txBody'))[0];
        const text = textOf(tc).trim();
        if (names[text]) setTextKeepFormat(p, names[text]);
    });
}

// "Web Application – …" slide titles carry the team's vertical
function retitle(slide, vertical) {
    if (vertical === 'Web Application') return;
    shapes(slide).filter(isPlaceholder).forEach(sh => {
        all(sh, NS.a, 't').forEach(t => { t.textContent = t.textContent.replace('Web Application', vertical); });
    });
}

const cellLines = v => {
    const str = v === null || v === undefined ? '' : String(v);
    return str.trim() ? str.replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, '')) : [''];
};
const pad2 = n => String(n).padStart(2, '0');
const countBy = (rows, key) => ['Completed', 'Ongoing', 'Upcoming'].map(k => rows.filter(r => r[key] === k).length);

// ------------------------------------------------------------ main
async function generate(rep, { template = TEMPLATE, imageDir } = {}) {
    const deck = await Deck.load(template);
    const [cover, hl, clientProto, initProto, notes, thanks] = deck.slides;
    const H = deck.height;
    const vertical = rep.team_vertical || 'Web Application';
    const order = [cover];

    // cover
    shapes(cover).filter(sh => txBodyOf(sh) && /\d{4}/.test(textOf(txBodyOf(sh)))).forEach(sh => {
        const ps = paragraphs(txBodyOf(sh));
        setTextKeepFormat(ps[0], rep.date_line);
        if (ps.length > 1) setTextKeepFormat(ps[1], rep.team_name);
    });

    // highlight
    const h = rep.highlight || {};
    if (h.enabled && h.images && h.images.length) {
        buildHighlight(deck, hl, h, vertical, imageDir);
        order.push(hl);
    }

    // client work: completed first, then the rest
    const rows = rep.client_rows;
    const counts = countBy(rows, 'status');
    const done = rows.filter(r => r.status === 'Completed');
    const rest = rows.filter(r => r.status !== 'Completed');
    let groups = [done, rest].filter(g => g.length);
    if (!groups.length) groups = [[]];
    for (const grp of groups) {
        const { data: frame } = findTables(clientProto);
        const rl = grp.map((r, i) => [cellLines(pad2(i + 1)), cellLines(r.name), cellLines(r.division), cellLines(r.type),
            cellLines(r.count || '1'), cellLines(r.start), cellLines(r.end), cellLines(r.status), cellLines(r.remark)]);
        const pages = rl.length ? paginate(frame, rl, H) : [[]];
        for (const page of pages) {
            const sl = deck.duplicate(clientProto);
            const { summary, data } = findTables(sl);
            fillSummary(summary, counts);
            fillDataTable(sl, data, page);
            if (rep.unit === 'task') renameHeaders(data, { 'Project Name': 'Task Name', 'Project Status': 'Task Status', 'Remark / Project details': 'Remark / Task details' });
            retitle(sl, vertical);
            order.push(sl);
        }
    }

    // initiatives
    const inits = rep.initiatives;
    const icounts = countBy(inits, 'status');
    const { data: iframe } = findTables(initProto);
    const irl = inits.map((r, i) => [cellLines(pad2(i + 1)), cellLines(r.name), cellLines(r.lead), cellLines(r.contributors),
        cellLines(r.vertical), cellLines(r.count || '01'), cellLines(r.start || 'TBD'), cellLines(r.end || 'TBD'),
        cellLines(r.status), cellLines(r.remark)]);
    for (const page of (irl.length ? paginate(iframe, irl, H) : [[]])) {
        const sl = deck.duplicate(initProto);
        const { summary, data } = findTables(sl);
        fillSummary(summary, icounts);
        fillDataTable(sl, data, page);
        retitle(sl, vertical);
        order.push(sl);
    }

    // notes
    const n = rep.notes || {};
    if (String(n.notable || '').trim() || String(n.challenges || '').trim()) {
        buildNotes(notes, n, deck.width);
        retitle(notes, vertical);
        order.push(notes);
    }

    order.push(thanks);
    return deck.save(order);
}

function buildHighlight(deck, slide, h, vertical, imageDir) {
    shapes(slide).forEach(sh => {
        if (!txBodyOf(sh)) return;
        if (isPlaceholder(sh)) {
            setShapeText(sh, `${vertical} – Highlighted Work`);
        } else {
            setShapeText(sh, h.title || '');
            const bodyPr = kid(txBodyOf(sh), NS.a, 'bodyPr');
            if (bodyPr) bodyPr.setAttribute('wrap', 'square');
            const g = geom(sh);
            if (g.ext) g.ext.setAttribute('cx', String(deck.width - 2 * g.left));
        }
    });
    const imgs = h.images.slice(0, 6).map(name => path.join(imageDir, name));
    const left = 424858, top = 1428484;
    const right = deck.width - 424858, bottom = deck.height - PAGE_BOTTOM_MARGIN;
    const count = imgs.length;
    const cols = Math.min(3, count);
    const nrows = Math.ceil(count / cols);
    const gap = 150000;
    const cw = Math.floor((right - left - gap * (cols - 1)) / cols);
    const ch = Math.floor((bottom - top - gap * (nrows - 1)) / nrows);
    const doc = slide.doc;
    imgs.forEach((file, i) => {
        const r = Math.floor(i / cols), c = i % cols;
        const { width: iw, height: ih } = imageSize(fs.readFileSync(file));
        const scale = Math.min(cw / iw, ch / ih);
        const w = Math.trunc(iw * scale), hgt = Math.trunc(ih * scale);
        const x = left + c * (cw + gap) + Math.floor((cw - w) / 2);
        const y = top + r * (ch + gap) + Math.floor((ch - hgt) / 2);
        const rid = deck.addImage(slide, file);
        const id = nextShapeId(slide);
        const pic = parseXml(`<p:pic xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
            + `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`
            + `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${hgt}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`).documentElement;
        spTree(slide).appendChild(doc.importNode(pic, true));
    });
}

function buildNotes(slide, n, slideW) {
    const labels = shapes(slide).filter(sh => txBodyOf(sh) && !isPlaceholder(sh)).sort((a, b) => geom(a).top - geom(b).top);
    const tops = labels.map(sh => geom(sh).top).concat([6858000 - PAGE_BOTTOM_MARGIN]);
    const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    ['notable', 'challenges'].forEach((key, i) => {
        const sh = labels[i];
        if (!sh) return;
        const ps = paragraphs(txBodyOf(sh));
        setTextKeepFormat(ps[0], key === 'notable' ? 'Notable Points:' : 'Challenges:');
        ps.slice(1).forEach(p => p.parentNode.removeChild(p));
        const g = geom(sh);
        g.ext.setAttribute('cx', '3000000');
        const y = g.top + g.height;
        const height = Math.max(300000, tops[i + 1] - y - 80000);
        const items = String(n[key] || '').split('\n').map(l => l.trim()).filter(Boolean);
        const lines = items.length ? items : ['—'];
        const id = nextShapeId(slide);
        const box = parseXml(`<p:sp xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:nvSpPr><p:cNvPr id="${id}" name="TextBox ${id - 1}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
            + `<p:spPr><a:xfrm><a:off x="${g.left}" y="${y}"/><a:ext cx="${slideW - 2 * g.left}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
            + `<p:txBody><a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr><a:lstStyle/>`
            + lines.map(it => `<a:p><a:r><a:rPr lang="en-US" sz="1400" dirty="0"><a:latin typeface="Arial"/></a:rPr><a:t>${esc(it !== '—' ? '• ' + it.replace(/^[•\-* ]+/, '') : it)}</a:t></a:r></a:p>`).join('')
            + `</p:txBody></p:sp>`).documentElement;
        spTree(slide).appendChild(slide.doc.importNode(box, true));
    });
}

module.exports = { generate, TEMPLATE };
