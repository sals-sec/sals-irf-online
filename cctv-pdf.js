/* Self-hosted PDF export matching sals-sir-online layout with exact CONFIDENTIAL watermark */
(function(root){
  async function createCctvPdf(request, logoSrc){
    const { PDFDocument, StandardFonts, rgb, degrees } = root.PDFLib;
    const pdf = await PDFDocument.create();
    const normal = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const W = 595.28, H = 841.89, M = 36, CW = W - M * 2;
    const ink = rgb(.12, .15, .19), muted = rgb(.38, .42, .47), border = rgb(.72, .75, .78), accent = rgb(.78, .18, .08);
    let page, y;

    let brand = null;
    if(logoSrc){
      try {
        let pngBytes;
        if(logoSrc.startsWith('data:image/png;base64,')){
          const b64 = logoSrc.split(',')[1];
          const bin = atob(b64);
          pngBytes = new Uint8Array(bin.length);
          for(let i=0; i<bin.length; i++) pngBytes[i] = bin.charCodeAt(i);
        } else {
          const resp = await fetch(logoSrc);
          pngBytes = await resp.arrayBuffer();
        }
        brand = await pdf.embedPng(pngBytes);
      } catch(e) {
        console.warn('Could not embed logo image in PDF:', e);
      }
    }

    const val = x => String(x ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
    const canEncode = (t, font) => { try { font.encodeText(t); return true; } catch { return false; } };
    const canvasContext = (t, size, strong) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      ctx.font = `${strong ? 'bold ' : ''}${size}px Arial, sans-serif`;
      return { canvas, ctx };
    };
    const width = (t, size, font) => canEncode(t, font) ? font.widthOfTextAtSize(t, size) : canvasContext(t, size, font === bold).ctx.measureText(t).width;

    async function text(str, x, top, size = 8.5, font = normal, color = ink){
      str = val(str);
      if(!str) return;
      if(canEncode(str, font)){
        page.drawText(str, { x, y: H - top - size, size, font, color });
        return;
      }
      const { canvas, ctx } = canvasContext(str, size, font === bold);
      const w = ctx.measureText(str).width;
      canvas.width = Math.ceil(w * 3 + 12);
      canvas.height = Math.ceil(size * 1.8 * 3);
      ctx.scale(3, 3);
      ctx.font = `${font === bold ? 'bold ' : ''}${size}px Arial, sans-serif`;
      ctx.fillStyle = '#202630';
      ctx.textBaseline = 'top';
      ctx.fillText(str, 1, 0);
      const image = await pdf.embedPng(canvas.toDataURL('image/png'));
      page.drawImage(image, { x, y: H - top - canvas.height / 3, width: canvas.width / 3, height: canvas.height / 3 });
    }

    function wrap(value, max, size = 8.5, font = normal){
      const result = [];
      for(const paragraph of val(value).split('\n')){
        if(!paragraph){ result.push(''); continue; }
        let line = '';
        for(const token of paragraph.split(/(\s+)/)){
          if(width(line + token, size, font) <= max){ line += token; continue; }
          if(line.trim()){ result.push(line.trimEnd()); line = ''; }
          const word = token.trimStart();
          for(const char of word){
            if(width(line + char, size, font) > max && line){ result.push(line); line = ''; }
            line += char;
          }
        }
        result.push(line.trimEnd());
      }
      return result;
    }

    const fmtD = d => {
      if(!d) return '';
      const [y, m, day] = String(d).split('-');
      return (y && m && day) ? `${day}/${m}/${y}` : d;
    };
    const fmt12 = t => {
      if(!t) return '';
      const [h, m] = t.split(':');
      const numH = parseInt(h, 10);
      if(isNaN(numH)) return t;
      const am = numH < 12 ? 'AM' : 'PM';
      return `${(numH % 12 || 12).toString().padStart(2, '0')}:${m} ${am}`;
    };
    const dayOf = d => {
      if(!d) return '';
      const dt = new Date(d + 'T00:00:00');
      return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-US', { weekday: 'long' });
    };

    const purposeList = (request.purposes || []).map(p => {
      if(p.startsWith('Other') && request.purposeOther) return 'Other: ' + request.purposeOther;
      return p;
    });
    if(!purposeList.length && request.purposeOther) purposeList.push('Other: ' + request.purposeOther);
    const purposeText = purposeList.length ? purposeList.join(', ') : 'Not specified';

    const footageList = (request.footage || []).map(f => {
      if(f.startsWith('Other') && request.footageOther) return 'Other: ' + request.footageOther;
      return f;
    });
    if(!footageList.length && request.footageOther) footageList.push('Other: ' + request.footageOther);
    const footageText = footageList.length ? footageList.join(', ') : 'Not specified';

    const mediaList = (request.media || []).map(m => {
      if(m.startsWith('Other') && request.mediaOther) return 'Other: ' + request.mediaOther;
      return m;
    });
    if(!mediaList.length && request.mediaOther) mediaList.push('Other: ' + request.mediaOther);
    const mediaText = mediaList.length ? mediaList.join(', ') : 'Not specified';

    const recTimeText = [fmt12(request.recFrom), fmt12(request.recTo)].filter(Boolean).join(' - ') || 'Full recording period';

    // Structured blocks
    const blocks = [];
    const section = title => blocks.push({ title });
    const row = (...pairs) => blocks.push({ pairs });
    const paragraph = (title, value) => { section(title); row(['', value]); };

    section('1. Request Information');
    row(['Request No.', request.no], ['Status', request.status || 'Submitted']);
    row(['Request Date', fmtD(request.reqDate)], ['Request Time', fmt12(request.reqTime)]);
    row(['Requestor Name', request.name], ['Employee ID', request.empId]);
    row(['Department', request.dept], ['Position', request.pos]);
    row(['Contact Number', request.contact], ['Email Address', request.email]);

    paragraph('2. Purpose of Request', purposeText);

    section('3. Recording Details');
    row(['Area / Location', request.area], ['Day', dayOf(request.recDate)]);
    row(['Recording Date', fmtD(request.recDate)], ['Recording Time', recTimeText]);

    section('4. Footage & Storage Media');
    row(['Footage Requested', footageText]);
    row(['Storage Media', mediaText]);

    paragraph('5. Declaration', 'I acknowledge that CCTV footage contains confidential and sensitive information. I agree that the footage will only be used for the approved investigation purpose and will not be copied, distributed, disclosed, or used for unauthorized purposes. I understand that any misuse may result in disciplinary or legal action.');
    row(['Requestor Signature (typed)', request.ack ? request.sigName : ''], ['Date', fmtD(request.sigDate)]);

    section('6. Security Review');
    row(['Received By', request.recvBy], ['Received Date', fmtD(request.recvDate)]);
    row(['Reviewed By', request.revBy], ['Footage Available', request.avail || '—']);
    row(['Recording Quality', request.quality || '—']);

    section('7. Approval');
    row(['Approver Signature (typed)', request.apprName], ['Approval Date', fmtD(request.apprDate)]);
    if(request.remarks) row(['Remarks', request.remarks]);

    const measure = size => blocks.map(b => {
      if(b.title) return { ...b, height: 16 };
      const cells = b.pairs.map(([label, value]) => {
        const w = CW / b.pairs.length;
        const lw = label ? Math.min(110, w * 0.38) : 0;
        return {
          w,
          lw,
          labels: label ? wrap(label, lw - 10, size, bold) : [],
          lines: wrap(value, w - lw - 12, size)
        };
      });
      return {
        cells,
        height: Math.max(16, ...cells.map(c => Math.max(c.labels.length, c.lines.length) * size * 1.22 + 7))
      };
    });

    const available = H - 84 - 36;
    let size = 8.5, layout = measure(size);
    while(layout.reduce((n, b) => n + b.height, 0) > available){
      size *= 0.94;
      layout = measure(size);
      if(size < 0.05) throw Error('Content is too large for one page.');
    }

    page = pdf.addPage([W, H]);
    y = 84;

    if(brand){
      page.drawImage(brand, { x: M, y: H - 49, width: 99, height: 25 });
    } else {
      await text('SALS', M, 26, 18, bold, accent);
    }
    await text('OEF-25 Rev 02', W - M - 76, 28, 10, bold);
    await text('CCTV Footage Request Form', M, 58, 13, bold);

    const box = (x, top, w, h, fill) => page.drawRectangle({
      x, y: H - top - h, width: w, height: h,
      borderColor: border, borderWidth: 0.45,
      ...(fill ? { color: fill } : {})
    });

    for(const block of layout){
      if(block.title){
        box(M, y, CW, block.height, rgb(.94, .95, .96));
        await text(block.title, M + 6, y + 3.5, 8, bold);
      } else {
        let x = M;
        for(const c of block.cells){
          box(x, y, c.w, block.height);
          if(c.lw) box(x, y, c.lw, block.height, rgb(.975, .977, .98));
          for(let i=0; i<c.labels.length; i++) await text(c.labels[i], x + 5, y + 3.5 + i * size * 1.22, size, bold, muted);
          for(let i=0; i<c.lines.length; i++) await text(c.lines[i], x + c.lw + 6, y + 3.5 + i * size * 1.22, size);
          x += c.w;
        }
      }
      y += block.height;
    }

    // Exact watermark from reference app report-pdf.js
    const watermark = 'CONFIDENTIAL', watermarkSize = 50, angle = 40 * Math.PI / 180;
    const watermarkWidth = bold.widthOfTextAtSize(watermark, watermarkSize);
    const watermarkHeight = bold.heightAtSize(watermarkSize, { descender: false });
    page.drawText(watermark, {
      x: W / 2 - (watermarkWidth * Math.cos(angle) - watermarkHeight * Math.sin(angle)) / 2,
      y: H / 2 - (watermarkWidth * Math.sin(angle) + watermarkHeight * Math.cos(angle)) / 2,
      size: watermarkSize,
      font: bold,
      color: rgb(.45, .45, .45),
      rotate: degrees(40),
      opacity: 0.22
    });

    await text('Request ' + val(request.no), M, H - 24, 8, normal, muted);
    const footer = 'Prepared By: ' + val(request.by || 'admin');
    const footerSize = Math.min(8, 8 * (CW - 135) / Math.max(1, width(footer, 8, normal)));
    await text(footer, M + 100, H - 24, footerSize, normal, muted);
    await text('1 / 1', W - M - 23, H - 24, 8, normal, muted);

    pdf.setTitle('CCTV Footage Request - ' + val(request.no));
    pdf.setAuthor('SALS');
    return pdf.save();
  }

  root.createCctvPdf = createCctvPdf;
})(typeof window === 'undefined' ? globalThis : window);
