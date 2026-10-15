/* Self-hosted PDF export. No report data is sent to a third-party service. */
(function(root){
async function createReportPdf(report, logo){
  const {PDFDocument,StandardFonts,rgb,degrees}=root.PDFLib;
  const pdf=await PDFDocument.create();
  const normal=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const W=595.28,H=841.89,M=36,CW=W-M*2;
  const ink=rgb(.12,.15,.19),muted=rgb(.38,.42,.47),border=rgb(.72,.75,.78),accent=rgb(.78,.18,.08);
  let page,y;
  let brand;if(logo)brand=await pdf.embedPng(logo);
  const val=x=>String(x??'').replace(/\r\n?/g,'\n').replace(/\t/g,'    ');
  const canEncode=(text,font)=>{try{font.encodeText(text);return true}catch{return false}};
  const canvasContext=(text,size,strong)=>{
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
    ctx.font=`${strong?'bold ':''}${size}px Arial, sans-serif`;
    return {canvas,ctx};
  };
  const width=(text,size,font)=>canEncode(text,font)?font.widthOfTextAtSize(text,size):canvasContext(text,size,font===bold).ctx.measureText(text).width;
  async function text(str,x,top,size=9,font=normal,color=ink){
    str=val(str);if(!str)return;
    if(canEncode(str,font)){page.drawText(str,{x,y:H-top-size,size,font,color});return;}
    // Use browser font fallback for names/statements outside the standard PDF font.
    const {canvas,ctx}=canvasContext(str,size,font===bold);const w=ctx.measureText(str).width;
    canvas.width=Math.ceil(w*3+12);canvas.height=Math.ceil(size*1.8*3);ctx.scale(3,3);
    ctx.font=`${font===bold?'bold ':''}${size}px Arial, sans-serif`;ctx.fillStyle='#202630';ctx.textBaseline='top';ctx.fillText(str,1,0);
    const image=await pdf.embedPng(canvas.toDataURL('image/png'));
    page.drawImage(image,{x,y:H-top-canvas.height/3,width:canvas.width/3,height:canvas.height/3});
  }
  function wrap(value,max,size=9,font=normal){
    const result=[];
    for(const paragraph of val(value).split('\n')){
      if(!paragraph){result.push('');continue;}
      let line='';
      for(const token of paragraph.split(/(\s+)/)){
        if(width(line+token,size,font)<=max){line+=token;continue;}
        if(line.trim()){result.push(line.trimEnd());line='';}
        const word=token.trimStart();
        for(const char of word){if(width(line+char,size,font)>max && line){result.push(line);line='';}line+=char;}
      }
      result.push(line.trimEnd());
    }
    return result;
  }
  // Measure the complete form before drawing. All fields stay on one A4 page.
  const blocks=[];
  const section=title=>blocks.push({title});
  const row=(...pairs)=>blocks.push({pairs});
  const paragraph=(title,value)=>{section(title);row(['',value]);};
  section('1. Report Information');
  row(['Report No.',report.reportNo],['Report Date / Time',[report.dateOfReport,report.timeOfReport].filter(Boolean).join(', ')]);
  row(['Employee Name',report.employeeName],['Passport No.',report.passportNo]);
  row(['Department',report.department],['Company / Agency',report.companyAgency]);
  row(['Supervisor',report.supervisor]);
  section('2. Incident Details');
  row(['Incident Type',report.typeOfIncident]);
  row(['Location',report.locationOfIncident],['Incident Date / Time',val(report.incidentDateTime).replace(/^(\d{4}-\d{2}-\d{2})T(?=\d{2}:\d{2})/,'$1, ')]);
  row(['Asset',report.asset],['Estimated Value (RM)',report.estimatedValue]);
  paragraph('3. Incident Description',report.incidentDescription);
  section('4. Personal Reference Details');
  row(['Name',report.refName],['Passport No.',report.refPassportNo]);
  row(['Department',report.refDepartment],['Company / Agency',report.refCompanyAgency]);
  paragraph('5. Employee Statement',report.employeeStatement);
  paragraph('6. Action By Investigating Officer',report.ioAction);
  section('7. Police Report (If Any)');
  row(['Police Report No.',report.policeReportNo],['Police Station',report.policeStationName]);
  row(['Officer Comments',report.ioComments]);
  const measure=size=>blocks.map(b=>{
    if(b.title)return {...b,height:17};
    const cells=b.pairs.map(([label,value])=>{
      const w=CW/b.pairs.length,lw=label?Math.min(92,w*.36):0;
      return {w,lw,labels:label?wrap(label,lw-10,size,bold):[],lines:wrap(value,w-lw-12,size)};
    });
    return {cells,height:Math.max(18,...cells.map(c=>Math.max(c.labels.length,c.lines.length)*size*1.22+8))};
  });
  const complainantSigName = (report.complainantName !== undefined && report.complainantName !== null && String(report.complainantName).trim())
    ? String(report.complainantName).trim()
    : (report.employeeName || '');
  const sigNames=[complainantSigName,report.recordingOfficerName || ''];
  const sigMeasure=size=>Math.max(...sigNames.map(n=>wrap(n,CW/2-16,size).length))*size*1.22+64;
  const available=H-84-40;
  let size=8.5,layout=measure(size);
  while(layout.reduce((n,b)=>n+b.height,0)+17+sigMeasure(size)>available){size*=.94;layout=measure(size);if(size<.05)throw Error('Report is too large for one page.');}
  page=pdf.addPage([W,H]);y=84;
  if(brand)page.drawImage(brand,{x:M,y:H-49,width:99,height:25});
  else await text('SALS',M,26,18,bold,accent);
  await text('OEF-23',W-M-45,28,10,bold);
  await text('Incident Report Form',M,58,13,bold);
  const box=(x,top,w,h,fill)=>page.drawRectangle({x,y:H-top-h,width:w,height:h,borderColor:border,borderWidth:.45,...(fill?{color:fill}:{})});
  for(const block of layout){
    if(block.title){box(M,y,CW,block.height,rgb(.94,.95,.96));await text(block.title,M+6,y+4,8,bold);}
    else{
      let x=M;
      for(const c of block.cells){
        box(x,y,c.w,block.height);
        if(c.lw)box(x,y,c.lw,block.height,rgb(.975,.977,.98));
        for(let i=0;i<c.labels.length;i++)await text(c.labels[i],x+5,y+4+i*size*1.22,size,bold,muted);
        for(let i=0;i<c.lines.length;i++)await text(c.lines[i],x+c.lw+6,y+4+i*size*1.22,size);
        x+=c.w;
      }
    }
    y+=block.height;
  }
  box(M,y,CW,17,rgb(.94,.95,.96));await text('8. Signatures',M+6,y+4,8,bold);y+=17;
  const sigHeight=sigMeasure(size);
  for(let i=0;i<2;i++){
    const x=M+i*CW/2;box(x,y,CW/2,sigHeight);
    await text(i?'Recording Officer (Security)':'Complainant',x+8,y+6,8,bold);
    const names=wrap(sigNames[i],CW/2-16,size);
    for(let j=0;j<names.length;j++)await text(names[j],x+8,y+20+j*size*1.22,size);
    const signature=i?report.sigOfficer:report.sigComplainant;
    if(signature){const image=await pdf.embedPng(signature);const scale=Math.min((CW/2-20)/image.width,34/image.height);page.drawImage(image,{x:x+10,y:H-y-sigHeight+5,width:image.width*scale,height:image.height*scale});}
  }
  // Draw above table fills so the watermark remains visible across every section.
  const watermark='CONFIDENTIAL',watermarkSize=50,angle=40*Math.PI/180;
  const watermarkWidth=bold.widthOfTextAtSize(watermark,watermarkSize);
  const watermarkHeight=bold.heightAtSize(watermarkSize,{descender:false});
  page.drawText(watermark,{
    x:W/2-(watermarkWidth*Math.cos(angle)-watermarkHeight*Math.sin(angle))/2,
    y:H/2-(watermarkWidth*Math.sin(angle)+watermarkHeight*Math.cos(angle))/2,
    size:watermarkSize,font:bold,color:rgb(.45,.45,.45),rotate:degrees(40),opacity:.22
  });
  await text('Report '+val(report.reportNo),M,H-25,8,normal,muted);
  const footer='Prepared By: '+val(report.preparedBy || 'Not Recorded');
  const footerSize=Math.min(8,8*(CW-135)/Math.max(1,width(footer,8,normal)));
  await text(footer,M+100,H-25,footerSize,normal,muted);
  await text('1 / 1',W-M-23,H-25,8,normal,muted);
  pdf.setTitle('Incident Report Form - '+val(report.reportNo));pdf.setAuthor('SALS');
  return pdf.save();
}
root.createReportPdf=createReportPdf;
})(typeof window==='undefined'?globalThis:window);
