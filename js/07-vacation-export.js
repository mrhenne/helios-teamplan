// Urlaub: Excel- und PDF-Export
// Teil von ZNA Core – Reihenfolge der Skripte in index.html ist relevant (gemeinsamer globaler Scope).
async function saveExportFile(filename,data,mime,description,extensions){
  const blob=data instanceof Blob?data:new Blob([data],{type:mime});
  try{
    if(window.showSaveFilePicker){
      const accept={};accept[mime]=extensions;
      const handle=await window.showSaveFilePicker({suggestedName:filename,types:[{description,accept}]});
      const writable=await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    }
  }catch(err){
    if(err?.name==='AbortError')return false;
    console.warn('Speichern unter nicht verfügbar',err);
  }
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  showToast('Datei heruntergeladen · Speicherort wird vom Browser bestimmt');
  return true;
}

async function exportExcel(){
  if(!window.XLSX){alert('Excel-Export ist nicht verfügbar.');return}
  const year=viewDate.getFullYear(),rows=[['Mitarbeiter','Jahresanspruch','Verbraucht nach Arbeitstagen','Rest','XU']];
  [...teamEmployees()].sort((a,b)=>a.order-b.order).forEach(e=>rows.push([e.name,actualVacationEntitlement(e),usedVacationActual(e,year),actualVacationEntitlement(e)-usedVacationActual(e,year),countCode(e,'XU',year)]));
  const detail=[['Datum','Mitarbeiter','Codes','Status','Priorität','Notiz']];
  teamEmployees().forEach(e=>Object.entries(state.entries[e.id]||{}).filter(([k])=>k.startsWith(year+'-')).forEach(([k,v])=>detail.push([k,e.name,(v.codes||[]).join('+'),v.status||'wish',v.priority||0,v.note||''])));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Urlaubskonten');XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(detail),'Planung');
  const filename=`TeamPlan-${year}.xlsx`,data=XLSX.write(wb,{bookType:'xlsx',type:'array'});
  const saved=await saveExportFile(filename,data,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Excel-Arbeitsmappe',['.xlsx']);
  if(saved)showToast('Excel gespeichert');
}
function reportPrintWindow(title,html,dialogId){
  const win=window.open('','_blank');
  if(!win){alert('PDF-Fenster wurde vom Browser blockiert. Bitte Pop-ups für TeamPlan erlauben.');return}
  win.document.open();win.document.write(html);win.document.close();
  if(dialogId)document.getElementById(dialogId)?.close();
  setTimeout(()=>{win.focus();win.print()},250);
}
function reportBaseHtml(title,subtitle,sections){
  return '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>'+escapeHtml(title)+'</title><style>@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#24332f;font-size:9px;line-height:1.35}header{border-bottom:2px solid #d8891c;padding-bottom:8px;margin-bottom:14px}h1{font-size:19px;margin:0}header p{margin:3px 0 0;color:#687b75}section{margin:0 0 16px;break-inside:auto}h2{font-size:13px;margin:0 0 7px;color:#915d13}h3{font-size:10px;margin:7px 0 4px}table{width:100%;border-collapse:collapse;font-size:8px}th,td{padding:4px 5px;border-bottom:1px solid #dfe8e5;text-align:left;vertical-align:top}th{background:#f5f7f6}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.card{border:1px solid #dfe8e5;border-radius:7px;padding:7px;break-inside:avoid}.card strong{display:block;font-size:11px}.muted,small{color:#71837e}.month-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.month{border:1px solid #dfe8e5;border-radius:6px;padding:6px;break-inside:avoid}.month h3{margin:0 0 4px}.status{font-weight:bold}.ok{color:#247a5a}.warn{color:#a66b00}.bad{color:#b13d3d}</style></head><body><header><h1>'+escapeHtml(title)+'</h1><p>'+escapeHtml(subtitle)+' · Erstellt am '+new Date().toLocaleString('de-DE')+'</p></header>'+sections.join('')+'</body></html>';
}
function buildVacationPdfHtml(options){
  const year=viewDate.getFullYear(),month=viewDate.getMonth(),sections=[],employees=[...teamEmployees()].sort((a,b)=>a.order-b.order);
  if(options.accounts){
    const rows=employees.map(e=>'<tr><td>'+escapeHtml(e.name)+'</td><td>'+formatVacationNumber(actualVacationEntitlement(e))+'</td><td>'+formatVacationNumber(usedVacationActual(e,year))+'</td><td>'+formatVacationNumber(actualVacationEntitlement(e)-usedVacationActual(e,year))+'</td><td>'+countCode(e,'XU',year)+'</td></tr>').join('');
    sections.push('<section><h2>Urlaubskonten '+year+'</h2><table><thead><tr><th>Mitarbeiter</th><th>Anspruch</th><th>Verbraucht</th><th>Rest</th><th>XU</th></tr></thead><tbody>'+rows+'</tbody></table></section>');
  }
  if(options.month){
    const prefix=year+'-'+String(month+1).padStart(2,'0')+'-';
    const rows=[];
    employees.forEach(e=>Object.entries(state.entries[e.id]||{}).filter(([k,v])=>k.startsWith(prefix)&&entryIsActive(v)&&(v.codes||[]).length).sort(([a],[b])=>a.localeCompare(b)).forEach(([k,v])=>rows.push('<tr><td>'+escapeHtml(new Date(k+'T12:00:00').toLocaleDateString('de-DE'))+'</td><td>'+escapeHtml(e.name)+'</td><td>'+escapeHtml((v.codes||[]).join(' + '))+'</td><td>'+escapeHtml(v.status||'wish')+'</td><td>'+escapeHtml(v.note||'')+'</td></tr>')));
    sections.push('<section><h2>Monatsübersicht '+MONTHS[month]+' '+year+'</h2><table><thead><tr><th>Datum</th><th>Mitarbeiter</th><th>Kürzel</th><th>Status</th><th>Notiz</th></tr></thead><tbody>'+(rows.join('')||'<tr><td colspan="5">Keine Einträge vorhanden.</td></tr>')+'</tbody></table></section>');
  }
  if(options.year){
    const blocks=Array.from({length:12},(_,m)=>{
      const prefix=year+'-'+String(m+1).padStart(2,'0')+'-';let count=0,names=[];
      employees.forEach(e=>{const n=Object.entries(state.entries[e.id]||{}).filter(([k,v])=>k.startsWith(prefix)&&entryIsActive(v)&&(v.codes||[]).some(c=>c==='U'||c==='XU'||c==='S')).length;if(n){count+=n;names.push(e.name+': '+n)}});
      return '<div class="month"><h3>'+MONTHS[m]+'</h3><strong>'+count+' Planungseinträge</strong><small>'+escapeHtml(names.join(' · ')||'Keine Abwesenheiten')+'</small></div>';
    }).join('');
    sections.push('<section><h2>Jahresübersicht '+year+'</h2><div class="month-grid">'+blocks+'</div></section>');
  }
  if(options.details){
    const rows=[];
    employees.forEach(e=>Object.entries(state.entries[e.id]||{}).filter(([k])=>k.startsWith(year+'-')).sort(([a],[b])=>a.localeCompare(b)).forEach(([k,v])=>{if((v.codes||[]).length||v.note)rows.push('<tr><td>'+escapeHtml(k)+'</td><td>'+escapeHtml(e.name)+'</td><td>'+escapeHtml((v.codes||[]).join(' + '))+'</td><td>'+escapeHtml(v.status||'wish')+'</td><td>'+Number(v.priority||0)+'</td><td>'+escapeHtml(v.note||'')+'</td></tr>')}));
    sections.push('<section><h2>Planungsdetails '+year+'</h2><table><thead><tr><th>Datum</th><th>Mitarbeiter</th><th>Kürzel</th><th>Status</th><th>Priorität</th><th>Notiz</th></tr></thead><tbody>'+(rows.join('')||'<tr><td colspan="6">Keine Einträge vorhanden.</td></tr>')+'</tbody></table></section>');
  }
  return reportBaseHtml('TeamPlan ZNA · Urlaubsbericht','Planungsjahr '+year,sections);
}
function exportPdf(){
  safeShowDialog('vacationExportDialog');
}
function exportVacationPdf(){
  const options={accounts:document.getElementById('vacationExportAccounts')?.checked,month:document.getElementById('vacationExportMonth')?.checked,year:document.getElementById('vacationExportYear')?.checked,details:document.getElementById('vacationExportDetails')?.checked};
  if(!Object.values(options).some(Boolean)){showToast('Bitte mindestens einen PDF-Inhalt auswählen');return}
  reportPrintWindow('Urlaubsbericht',buildVacationPdfHtml(options),'vacationExportDialog');
}
