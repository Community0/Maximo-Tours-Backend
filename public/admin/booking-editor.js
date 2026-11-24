(()=>{'use strict';
const A=window.Ogre,O=window.OgreOps,E=A.el,$=s=>document.querySelector(s);
const tours=[['roma-iconica','Roma Iconica'],['roma-completa','Roma Completa'],['la-dolce-vita','La Dolce Vita'],['roma-by-night','Roma by Night']];
async function open(id){if(!O.state.ready)return;const generation=O.state.generation;try{
 const [rs,data]=await Promise.all([A.api('resources'),id?A.api('bookings/'+encodeURIComponent(id)):Promise.resolve(null)]);if(generation!==O.state.generation||!O.state.ready)return;O.state.resources=rs.resources;
 const b=data?.booking,d=O.dialog(b?'Modifica prenotazione':'Nuova prenotazione'),f=E('form');f.id='booking-editor';
 f.innerHTML=`<p class="form-hint">Una prenotazione può comprendere più golf cart. Disponibilità, posti e assegnazioni vengono controllati prima del salvataggio. Nessuna email viene inviata da questo modulo.</p>
 <fieldset><legend>Ospite e provenienza</legend><div class="form-grid">
 <label>Nome e cognome<input name="name" required maxlength="150" autocomplete="off"></label><label>Telefono<input name="phone" type="tel" required maxlength="40" autocomplete="off"></label>
 <label>Email (facoltativa)<input name="email" type="email" maxlength="254" autocomplete="off"></label><label>Lingua<select name="lang"><option value="en">Inglese</option><option value="it">Italiano</option><option value="fr">Francese</option><option value="es">Spagnolo</option><option value="de">Tedesco</option></select></label>
 <label>Provenienza<select name="source"><option value="phone">Telefono</option><option value="whatsapp">WhatsApp</option><option value="hotel">Hotel</option><option value="email">Email</option><option value="walk-in">Di persona</option><option value="partner">Partner</option><option value="other">Altro</option><option value="website">Sito web</option></select></label><label>Hotel / partner di provenienza<input name="sourceLabel" maxlength="200"></label>
 </div></fieldset><fieldset><legend>Il tour</legend><div class="form-grid">
 <label>Itinerario<select name="tourId"></select></label><label>Hotel e indirizzo del pickup<input name="hotel" required maxlength="300"></label>
 <label>Data<input name="date" type="date" required></label><label>Partenza (ora di Roma)<input name="time" type="time" required></label>
 <label>Tappe extra (solo Dolce Vita)<input name="extraStops" type="number" min="0" max="6" value="0" required></label><label>Richieste dell’ospite<textarea name="notes" maxlength="3000" rows="2"></textarea></label>
 </div></fieldset><div class="cart-heading"><h3>Ospiti, autisti e mezzi</h3><button type="button" id="add-cart">Aggiungi golf cart</button></div><div id="editor-carts"></div>
 <p class="form-hint" id="cart-count"></p><div class="quote-line"><div><small>Totale di listino per tutti i golf cart</small><strong id="editor-quote">Da calcolare</strong></div><button type="button" id="calculate-quote" class="quiet">Calcola prezzo</button></div>
 <fieldset><legend>Importo e pagamento</legend><div class="form-grid"><label>Totale concordato (€)<input name="total" type="number" min="0.01" max="100000" step="0.01" required></label><label>Motivo di un prezzo diverso dal listino<input name="priceReason" maxlength="500"></label>
 <label id="manual-method">Metodo<select name="paymentMethod"><option value="unpaid">Da incassare</option><option value="cash">Contanti</option><option value="bank_transfer">Bonifico</option><option value="external_pos">POS esterno</option></select></label>
 <label id="manual-payment">Stato incasso<select name="paymentStatus"><option value="unpaid">Non incassato</option><option value="paid">Già incassato</option></select></label></div>
 <label class="check-line" id="price-ack"><input name="keepAgreedPrice" type="checkbox">Mantengo il totale già pagato, anche se il listino del nuovo tour è diverso. Nessun nuovo addebito o rimborso.</label>
 <label class="check-line" id="payment-ack" hidden><input name="paymentConfirmed" type="checkbox">Confermo di avere già ricevuto l’intero importo dal cliente.</label>
 <p class="form-hint" id="paid-note"></p></fieldset>
 <label>Note interne<textarea name="notesAdmin" maxlength="5000" rows="3"></textarea></label><p class="form-error" role="alert" id="editor-error"></p>
 <div class="form-actions"><button type="button" id="cancel-editor" class="quiet">Annulla</button><button type="submit" id="save-booking">Salva prenotazione</button></div>`;
 const elements=f.elements,list=f.querySelector('#editor-carts'),error=f.querySelector('#editor-error');
 for(const [value,label] of tours)elements.tourId.add(new Option(label,value));
 for(const field of ['name','email','phone','date','time','notes'])elements[field].value=b?.[field]||'';
 elements.date.value=b?.date||O.today();elements.time.value=b?.time||'09:00';elements.date.min=O.today();elements.lang.value=b?.breakdown?.lang||'en';elements.tourId.value=b?.breakdown?.tourId||tours[0][0];elements.hotel.value=b?.breakdown?.hotel||'';elements.extraStops.value=b?.breakdown?.extraStops||0;elements.notesAdmin.value=b?.notes_admin||'';elements.sourceLabel.value=b?.source_label||'';elements.priceReason.value=b?.breakdown?.priceReason||'';elements.source.value=b?.source_kind||'phone';elements.source.disabled=!!b;
 if(b)elements.total.value=Number(b.amount).toFixed(2);
 const fixed=!!b&&(b.payment_method==='stripe'||b.payment_status==='paid');elements.total.readOnly=fixed;
 f.querySelector('#manual-method').hidden=!!b;f.querySelector('#manual-payment').hidden=!!b;f.querySelector('#price-ack').hidden=b?.payment_method!=='stripe';
 f.querySelector('#paid-note').textContent=fixed?'L’importo incassato resta invariato. Per differenze da incassare o rimborsare occorre una gestione separata e concordata con il cliente.':'';
 function count(){const carts=O.readCarts(list);f.querySelector('#cart-count').textContent=carts.reduce((n,c)=>n+(c.people||0),0)+' ospiti · '+carts.length+' golf cart';}
 function add(cart){const row=O.cartInputs(list,cart);row.append(O.button('Rimuovi',()=>{if(list.children.length>1){row.remove();count();}}));row.addEventListener('input',count);count();}
 for(const cart of data?.carts?.length?data.carts:[{people:b?+b.people:2}])add(cart);
 f.querySelector('#add-cart').addEventListener('click',()=>add({people:1}));
 function payload(){return {name:elements.name.value,email:elements.email.value,phone:elements.phone.value,tourId:elements.tourId.value,date:elements.date.value,time:elements.time.value,hotel:elements.hotel.value,lang:elements.lang.value,extraStops:+elements.extraStops.value,notes:elements.notes.value,notesAdmin:elements.notesAdmin.value,source:elements.source.value,sourceLabel:elements.sourceLabel.value,carts:O.readCarts(list),totalCents:Math.round(+elements.total.value*100),priceReason:elements.priceReason.value,keepAgreedPrice:elements.keepAgreedPrice.checked};}
 const quoteButton=f.querySelector('#calculate-quote');quoteButton.addEventListener('click',async()=>{quoteButton.disabled=true;error.textContent='';try{const q=await A.api('manual-quote',payload());f.querySelector('#editor-quote').textContent=A.money(q.totalCents/100);if(!fixed)elements.total.value=(q.totalCents/100).toFixed(2);}catch(e){error.textContent=e.message;}finally{quoteButton.disabled=false;}});
 elements.tourId.addEventListener('change',()=>{if(elements.tourId.value!=='la-dolce-vita')elements.extraStops.value='0';elements.extraStops.readOnly=elements.tourId.value!=='la-dolce-vita';});elements.extraStops.readOnly=elements.tourId.value!=='la-dolce-vita';
 elements.paymentStatus.addEventListener('change',()=>{const paid=elements.paymentStatus.value==='paid';f.querySelector('#payment-ack').hidden=!paid;elements.paymentConfirmed.required=paid;});
 f.querySelector('#cancel-editor').addEventListener('click',()=>d.close());const requestId=crypto.randomUUID();
 f.addEventListener('submit',async e=>{e.preventDefault();if(!f.reportValidity())return;e.submitter.disabled=true;error.textContent='';try{
  const p=payload();if(!b){p.requestId=requestId;p.paymentMethod=elements.paymentMethod.value;p.paymentStatus=elements.paymentStatus.value;if(p.paymentStatus==='paid'&&!elements.paymentConfirmed.checked)throw Error('Conferma prima l’incasso già ricevuto.');}
  else p.version=b.updated_at;
  await A.api(b?'bookings/'+encodeURIComponent(b.id)+'/details':'manual-bookings',p);d.close();$('#details').close();await A.load();A.message(b?'Prenotazione aggiornata. Comunica al cliente i dettagli concordati.':'Prenotazione creata e disponibilità riservata.');if(!$('#planner-panel').hidden)await O.calendar();
 }catch(err){error.textContent=err.message;error.scrollIntoView({block:'nearest'});}finally{e.submitter.disabled=false;}});
 d.append(f);d.showModal();
 }catch(e){A.message(e.message,true);}}
window.OgreEditor={open};
})();
