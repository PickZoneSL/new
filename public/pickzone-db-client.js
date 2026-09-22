/* PickZoneSL DB integration: persistence/auth/cart/orders only. UI markup remains in the existing pages. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const isAdminPage=!!$('loginScreen') && !!$('productsTable');
  const isMainPage=!!$('featuredGrid') && !!$('cartItems');
  const API='/api';
  const STATUS_LABELS={pending:'Pending',confirmed:'Confirmed',processing:'Processing',shipped:'Shipped',delivered:'Delivered',cancelled:'Cancelled'};
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=v=>'LKR '+Number(v||0).toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
  async function api(path,opts={}){
    const o={credentials:'same-origin',headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts};
    if(o.body && typeof o.body!=='string') o.body=JSON.stringify(o.body);
    const r=await fetch(API+path,o); let data=null; try{data=await r.json()}catch(_){data={}};
    if(!r.ok){const e=new Error(data.message||'Request failed');e.status=r.status;e.data=data;throw e} return data;
  }
  const showMain=(title,msg,type='error')=>{if(typeof window.showAlert==='function')window.showAlert(title,msg);else alert(msg)};
  const showMainToast=msg=>{if(typeof window.showToast==='function')window.showToast(msg);else if(typeof window.showAlert==='function')window.showAlert('PickZone',msg)};
  const showAdminToast=(msg,type='success')=>{if(typeof window.toast==='function')window.toast(msg,type)};

  function statusClass(s){return s==='delivered'?'delivered':s==='cancelled'?'cancelled':s==='shipped'||s==='processing'||s==='confirmed'?'on_the_road':'pending'}
  function normalizeProduct(p){
    if(!p)return p;
    return {...p,uid:p.uid||('pz-'+p.id),code:p.code||'',title:p.title||'',description:p.description||'',price:Number(p.price)||0,othersPrice:Number(p.othersPrice||p.others_price)||0,discount:Number(p.discount)||0,stock:Math.max(0,Number(p.stock)||0),images:Array.isArray(p.images)?p.images:[],categories:Array.isArray(p.categories)?p.categories:(p.category_name?[p.category_name]:[])};
  }

  if(isAdminPage){
    let productCache=[], userCache=[], orderCache=[], adminReady=false;
    const refreshAdminData=async()=>{
      const [p,u,o]=await Promise.all([api('/products?all=true'),api('/admin/customers'),api('/admin/orders')]);
      productCache=(p.products||[]).map(normalizeProduct); userCache=u.customers||[]; orderCache=o.orders||[];
      window.getProducts=()=>productCache; window.getUsers=()=>userCache; window.getOrders=()=>orderCache;
      adminReady=true;
      return true;
    };
    window.getProducts=()=>productCache;window.getUsers=()=>userCache;window.getOrders=()=>orderCache;

    function ensureStockField(){
      const f=$('apStock');
      if(f){f.min='0';f.step='1';return}
      const grid=$('apCode')?.closest('.form-grid'); if(!grid)return;
      const wrap=document.createElement('div');wrap.className='form-group';wrap.innerHTML='<label>Stock *</label><input type="number" id="apStock" placeholder="10" min="0" step="1">';
      const price=$('apPrice')?.closest('.form-group'); if(price)price.insertAdjacentElement('afterend',wrap);else grid.insertBefore(wrap,grid.firstElementChild);
    }
    const origOpenAdd=window.openAddProductModal;
    window.openAddProductModal=function(){ensureStockField();if($('apStock'))$('apStock').value='0';return origOpenAdd?.apply(this,arguments)};
    const origEdit=window.editProduct;
    window.editProduct=function(idx){ensureStockField();const p=productCache[idx];if(p&&$('apStock'))$('apStock').value=String(p.stock??0);return origEdit?.apply(this,arguments)};
    const origView=window.viewProduct;
    window.viewProduct=function(idx){return origView?.apply(this,arguments)};

    window.adminLogin=async function(){
      const email=$('adminEmail')?.value.trim(),password=$('adminPassword')?.value||'';
      const err=$('loginError'),msg=$('loginErrorMsg');
      try{const data=await api('/auth/admin/login',{method:'POST',body:{email,password}});window.adminUser=data.admin;sessionStorage.setItem('pickzone_admin_db','1');err?.classList.remove('show');await refreshAdminData();if(typeof window.showApp==='function')window.showApp();}
      catch(e){if(err){err.classList.add('show');if(msg)msg.textContent=e.data?.message||'Invalid credentials. Access denied.'}else showAdminToast(e.data?.message||'Login failed','error');}
    };
    window.checkAdminAuth=async function(){
      try{const me=await api('/auth/admin/me');if(me.authenticated){window.adminUser=me.admin;await refreshAdminData();if(typeof window.showApp==='function')window.showApp();return;}}
      catch(_){ }
      window.adminUser=null;sessionStorage.removeItem('pickzone_admin_db');$('loginScreen')?.classList.remove('hidden');$('app')?.classList.remove('active');
    };
    window.adminLogout=async function(){try{await api('/auth/admin/logout',{method:'POST'})}catch(_){}window.adminUser=null;sessionStorage.removeItem('pickzone_admin_db');$('app')?.classList.remove('active');$('loginScreen')?.classList.remove('hidden');if($('adminEmail'))$('adminEmail').value='';if($('adminPassword'))$('adminPassword').value='';};

    const originalShowApp=window.showApp;
    window.showApp=function(){ensureStockField();return originalShowApp?.apply(this,arguments)};

    window.addProduct=async function(){
      ensureStockField();
      const code=$('apCode')?.value.trim(),title=$('apTitle')?.value.trim(),price=Number($('apPrice')?.value),stock=Math.max(0,parseInt($('apStock')?.value||'0',10)||0),description=$('apDescription')?.value.trim()||'',categories=($('apCategories')?.value||'').split(',').map(s=>s.trim()).filter(Boolean),images=($('apImages')?.value||'').split(',').map(s=>s.trim()).filter(Boolean);
      if(!code||!title||!Number.isFinite(price)||price<0){showAdminToast('Code, title, and price are required!','error');return}
      try{await api('/admin/products',{method:'POST',body:{code,title,price,stock,description,categories,images}});closeModal('addProductModal');showAdminToast('Product added!');await refreshAdminData();renderProducts();renderDashboard();}catch(e){showAdminToast(e.data?.message||'Unable to add product.','error')}
    };
    window.saveProductEdit=async function(idx){
      ensureStockField(); const p=productCache[idx];if(!p)return;
      const id=p.id,code=$('apCode')?.value.trim(),title=$('apTitle')?.value.trim(),price=Number($('apPrice')?.value),stock=Math.max(0,parseInt($('apStock')?.value||'0',10)||0),description=$('apDescription')?.value.trim()||'',categories=($('apCategories')?.value||'').split(',').map(s=>s.trim()).filter(Boolean),images=($('apImages')?.value||'').split(',').map(s=>s.trim()).filter(Boolean);
      if(!code||!title||!Number.isFinite(price)||price<0){showAdminToast('Code, title, and price are required!','error');return}
      try{await api('/admin/products/'+encodeURIComponent(id),{method:'PUT',body:{code,title,price,stock,description,categories,images}});closeModal('addProductModal');showAdminToast('Product updated successfully!');await refreshAdminData();renderProducts();renderDashboard();}catch(e){showAdminToast(e.data?.message||'Unable to update product.','error')}
    };
    window.deleteProduct=async function(idx){const p=productCache[idx];if(!p)return;if(!confirm('Delete this product?'))return;try{await api('/admin/products/'+encodeURIComponent(p.id),{method:'DELETE'});showAdminToast('Product deleted!');await refreshAdminData();renderProducts();renderDashboard()}catch(e){showAdminToast(e.data?.message||'Unable to delete product.','error')}};

    window.renderOrders=function(){
      const orders=orderCache, q=String(window.ordersSearchTerm||'').toLowerCase();const filtered=q?orders.filter(o=>String(o.id).toLowerCase().includes(q)||String(o.customer?.name||'').toLowerCase().includes(q)||String(o.email||'').toLowerCase().includes(q)):orders;
      const rows=[...filtered].map((o)=>{const idx=orders.findIndex(x=>String(x.id)===String(o.id));const st=o.status||'pending';const bc=statusClass(st)==='delivered'?'badge-delivered':statusClass(st)==='cancelled'?'badge-cancelled':statusClass(st)==='on_the_road'?'badge-road':'badge-pending';return `<tr><td style="font-weight:700;color:var(--primary)">${esc(o.id)}</td><td><div style="font-weight:600">${esc(o.customer?.name||'N/A')}</div><div style="font-size:11px;color:var(--text-secondary)">${esc(o.email||'')}</div></td><td>${esc((o.items||[]).map(i=>i.title).join(', ').slice(0,30))}${(o.items||[]).map(i=>i.title).join(', ').length>30?'...':''}</td><td style="font-weight:700">LKR ${Number(o.total||0).toLocaleString()}</td><td><span class="badge ${bc}">${STATUS_LABELS[st]||'Pending'}</span></td><td>${new Date(o.date).toLocaleDateString()}</td><td><div style="display:flex;gap:4px"><button class="btn btn-primary btn-sm" onclick="openStatusModal(${idx})" title="Update Status"><i class="fas fa-edit"></i></button><button class="btn btn-danger btn-sm" onclick="deleteOrder(${idx})" title="Delete"><i class="fas fa-trash"></i></button></div></td></tr>`}).join('');
      if($('allOrdersTable'))$('allOrdersTable').innerHTML=rows||'<tr><td colspan="7" class="empty"><i class="fas fa-receipt"></i><p>No orders found</p></td></tr>';
      if($('ordersBadge'))$('ordersBadge').textContent=String(orders.filter(o=>!['delivered','cancelled'].includes(o.status)).length);
    };
    window.openStatusModal=function(idx){const o=orderCache[idx];if(!o)return;if($('statusOrderId'))$('statusOrderId').textContent=o.id;if($('statusSelect'))$('statusSelect').value=o.status||'pending';if($('statusMsg'))$('statusMsg').value='';if($('statusOrderIdx'))$('statusOrderIdx').value=String(idx);openModal('statusModal')};
    window.updateOrderStatus=async function(){const idx=Number($('statusOrderIdx')?.value),o=orderCache[idx],status=$('statusSelect')?.value,message=$('statusMsg')?.value.trim()||'';if(!o)return;try{await api('/admin/orders/'+encodeURIComponent(o.id)+'/status',{method:'PATCH',body:{status,message}});closeModal('statusModal');showAdminToast('Order status updated!');await refreshAdminData();renderOrders();renderDashboard();}catch(e){showAdminToast(e.data?.message||'Unable to update order status.','error')}};
    window.deleteOrder=async function(idx){const o=orderCache[idx];if(!o||!confirm('Delete this order?'))return;try{await api('/admin/orders/'+encodeURIComponent(o.id),{method:'DELETE'});showAdminToast('Order deleted!');await refreshAdminData();renderOrders();renderDashboard()}catch(e){showAdminToast(e.data?.message||'Unable to delete order.','error')}};

    const baseDashboard=window.renderDashboard;
    window.renderDashboard=function(){if(typeof baseDashboard==='function')baseDashboard();};
    // Product data is always read from the DB cache, never from localStorage.
    async function bootAdmin(){try{await checkAdminAuth();}catch(e){$('loginScreen')?.classList.remove('hidden')}}
    window.addEventListener('load',()=>setTimeout(bootAdmin,10),{once:true});
    setInterval(async()=>{if(!adminReady)return;try{await refreshAdminData();const sec=document.querySelector('.page-section.active')?.id;if(sec==='sec-products')renderProducts();if(sec==='sec-orders')renderOrders();if(sec==='sec-customers')renderCustomers();renderDashboard();}catch(_){}},5000);
  }

  if(isMainPage){
    let productCache=[];let categoriesCache=[];let cartRefreshTimer=null;let lastOrderSignature='';
    const originalRenderCart=window.renderCart;
    window.__pzOriginalRenderCart=originalRenderCart;
    window.getProducts=()=>productCache;
    const refreshProducts=async()=>{try{const data=await api('/products?all=true');productCache=(data.products||[]).map(normalizeProduct);window.getProducts=()=>productCache; if(Array.isArray(window.PICKZONE_CATEGORIES)){} if(typeof window.renderCategoryFilters==='function')window.renderCategoryFilters();if(typeof window.renderFeatured==='function')window.renderFeatured();if(typeof window.renderItems==='function'&&typeof currentPage!=='undefined'&&currentPage==='items')window.renderItems(currentCategory||'All',true);return true}catch(e){console.warn('[PickZoneSL] product refresh failed',e);return false}};
    const refreshCategories=async()=>{try{const d=await api('/categories');categoriesCache=d.categories||[]; if(typeof window.renderCategoryFilters==='function')window.renderCategoryFilters();return true}catch(_){return false}};

    window.isAuthenticated=()=>!!(currentUser&&currentUser.email);
    window.loadCurrentUser=async function(){try{const d=await api('/auth/me');if(d.authenticated){currentUser=d.customer;await loadRemoteCart();}else{currentUser=null;cart=[];}}catch(_){currentUser=null;cart=[];}};
    window.handleSignUp=async function(){
      const email=$('suEmail')?.value.trim().toLowerCase(),whatsapp=$('suWhatsapp')?.value.trim(),password=$('suPassword')?.value.trim(),confirm=$('suConfirm')?.value.trim();
      if(!email||!isValidEmail(email)){showMain('Sign Up Error','Valid @gmail.com required');return}
      if(!whatsapp||!/^[0-9]{9,15}$/.test(whatsapp)){showMain('Sign Up Error','9-15 digits required');return}
      if(!password||!/^[0-9]{4,}$/.test(password)){showMain('Sign Up Error','Min 4 digits');return}
      if(password!==confirm){showMain('Sign Up Error','Passwords mismatch');return}
      try{await api('/auth/register',{method:'POST',body:{email,whatsapp,password}});closeModal('signUpModal');showMain('Account Created!','Please sign in to continue.','success');setTimeout(()=>{closeAlert?.();showSignIn?.();if($('siEmail'))$('siEmail').value=email},700)}catch(e){showMain('Sign Up Error',e.data?.message||'Unable to create account.')}
    };
    window.handleSignIn=async function(){
      const email=$('siEmail')?.value.trim().toLowerCase(),password=$('siPassword')?.value||'';if(!email||!password){showMain('Error','Enter email and password');return}if(!isValidEmail(email)){showMain('Error','Enter a valid Gmail address');return}
      try{const d=await api('/auth/login',{method:'POST',body:{email,password}});currentUser=d.customer;await loadRemoteCart();closeModal('signInModal');if(typeof updateAuthUI==='function')updateAuthUI();if(typeof navigateTo==='function')navigateTo(window.pzPendingMemberPage||'home');window.pzPendingMemberPage='';if(typeof renderCart==='function')renderCart();if(typeof renderOrdersPage==='function'&&currentPage==='orders')renderOrdersPage();showMainToast('Signed in successfully!')}catch(e){showMain('Error',e.data?.message||'Invalid email or password')}
    };
    window.logout=async function(){try{await api('/auth/logout',{method:'POST'})}catch(_){}currentUser=null;cart=[];if(typeof updateAuthUI==='function')updateAuthUI();if(typeof navigateTo==='function')navigateTo('home');};
    window.saveProfile=async function(){
      if(!currentUser)return;const fullName=$('profFullName')?.value.trim()||'',contactNumber2=$('profContact2')?.value.trim()||'',nearestCity=$('profCity')?.value.trim()||'',province=$('profProvince')?.value.trim()||'',district=$('profDistrict')?.value.trim()||'',deliveryAddress=$('profAddress')?.value.trim()||'';
      if(!contactNumber2||!nearestCity||!province||!deliveryAddress){showMain('Missing Information','Please complete Contact Number 2, Nearest City, Province and Delivery Address.');return}
      try{const d=await api('/auth/profile',{method:'PUT',body:{fullName,contactNumber2,nearestCity,province,district,deliveryAddress}});currentUser=d.customer;showMainToast('Delivery information saved successfully!');if(typeof renderDeliveryInfo==='function')renderDeliveryInfo()}catch(e){showMain('Profile Error',e.data?.message||'Unable to save profile.')}
    };

    async function loadRemoteCart(){if(!currentUser){cart=[];return[]}try{const d=await api('/cart');cart=(d.items||[]).map(x=>({...normalizeProduct(x.product),qty:Number(x.quantity)||1,selected:true}));if(typeof updateCartCount==='function')updateCartCount();return cart}catch(e){console.warn('[PickZoneSL] cart load failed',e);cart=[];return[]}}
    window.loadCart=()=>cart;
    window.saveCart=()=>Promise.resolve();
    window.normalizeCartProducts=()=>{cart=(cart||[]).map(x=>({...normalizeProduct(x),qty:Math.max(1,Number(x.qty)||1),selected:x.selected!==false}));};
    window.addToCart=async function(identifier,quantity=1){
      if(!window.isAuthenticated()){window.pzPendingMemberPage='cart';showSignIn?.();return false}
      const p=productCache.find(x=>String(x.uid)===String(identifier)||String(x.code)===String(identifier)||String(x.id)===String(identifier));if(!p)return false;const qty=Math.max(1,parseInt(quantity||1,10)||1);
      try{const d=await api('/cart/items',{method:'POST',body:{productId:p.id,quantity:qty}});cart=(d.items||[]).map(x=>({...normalizeProduct(x.product),qty:Number(x.quantity)||1,selected:true}));updateCartCount?.();if(currentPage==='cart')renderCart?.();showCartCongratulations?.(p,qty);return true}catch(e){showMain('Cart Error',e.data?.message||'Unable to add this product.');return false}
    };
    window.updateCartQty=async function(idx,delta){const item=cart[idx];if(!item)return;const next=Math.max(1,(Number(item.qty)||1)+(Number(delta)||0));try{const d=await api('/cart/items/'+encodeURIComponent(item.id),{method:'PATCH',body:{quantity:next}});cart=(d.items||[]).map(x=>({...normalizeProduct(x.product),qty:Number(x.quantity)||1,selected:true}));updateCartCount?.();renderCart?.()}catch(e){showMain('Cart Error',e.data?.message||'Unable to update quantity.')}};
    window.removeFromCart=async function(idx){const item=cart[idx];if(!item)return;try{const d=await api('/cart/items/'+encodeURIComponent(item.id),{method:'DELETE'});cart=(d.items||[]).map(x=>({...normalizeProduct(x.product),qty:Number(x.quantity)||1,selected:true}));updateCartCount?.();renderCart?.()}catch(e){showMain('Cart Error',e.data?.message||'Unable to remove item.')}};
    window.renderCart=async function(){if(!window.isAuthenticated()){cart=[];const host=$('cartItems');if(host)host.innerHTML='<div class="empty-state"><i class="fas fa-lock"></i><p>Sign in to view your cart.</p></div>';const sum=$('cartSummary');if(sum)sum.style.display='none';return}await loadRemoteCart();if(typeof window.__pzOriginalRenderCart==='function')window.__pzOriginalRenderCart();};

    async function renderRemoteOrders(){
      if(!window.isAuthenticated())return;const host=$('activeOrdersSection');if(!host)return;
      try{const d=await api('/orders/my');const mine=d.orders||[];const sig=JSON.stringify(mine.map(o=>[o.id,o.status,o.total,o.updatedAt]));const signatureChanged=sig!==lastOrderSignature;lastOrderSignature=sig;
        if(!mine.length){host.innerHTML='<div class="empty-state" style="padding:30px"><i class="fas fa-box-open"></i><p>No purchased items yet.</p></div>';return}
        let html='<div class="pz-orders-title">All Purchased Items & Orders</div>';
        mine.forEach(o=>{const st=o.status||'pending';const info=[STATUS_LABELS[st]||'Pending',st==='delivered'?'fa-circle-check':st==='cancelled'?'fa-circle-xmark':st==='shipped'?'fa-truck':st==='processing'?'fa-box-open':st==='confirmed'?'fa-check-circle':'fa-clock'];html+='<section class="pz-order-shell"><div class="pz-order-head"><div><div class="pz-order-id">'+esc(o.id)+'</div><div style="font-size:10px;color:var(--text-secondary)">'+new Date(o.date||Date.now()).toLocaleString()+'</div></div><span class="pz-order-status-chip"><i class="fas '+info[1]+'"></i> '+esc(info[0])+'</span></div><div class="pz-order-product-grid">'+(o.items||[]).map((it,ii)=>'<article class="pz-order-product-card"><div class="photo">'+(it.images?.[0]?'<img src="'+esc(it.images[0])+'" alt="'+esc(it.title||'Product')+'" style="width:100%;height:100%;object-fit:contain">':'<div class="detail-placeholder"><i class="fas fa-image"></i></div>')+'</div><div class="body"><div class="name">'+esc(it.title||'Product')+'</div><div class="meta">'+esc(it.code||'')+' · Qty '+(it.quantity||1)+'</div><div class="price">'+money(it.unitPrice||0)+'</div><button class="pz-order-status-btn" type="button" onclick="window.pzViewOrderStatus('+JSON.stringify(o.id)+')"><i class="fas fa-location-dot"></i> View Live Order Status</button></div></article>').join('')+'</div><div style="display:flex;justify-content:flex-end;gap:12px;align-items:center;margin-top:11px"><strong style="font-size:11px">Order Total: '+money(o.total||0)+'</strong><button class="pz-order-status-btn" style="width:auto;padding:8px 12px" type="button" onclick="window.pzViewOrderStatus('+JSON.stringify(o.id)+')"><i class="fas fa-satellite-dish"></i> Check Status</button></div></section>'});
        host.innerHTML=html;
        if(signatureChanged&&typeof updateNotifBell==='function')updateNotifBell();
      }catch(e){console.warn('[PickZoneSL] orders refresh failed',e)}
    }
    window.renderOrdersPage=renderRemoteOrders;
    window.pzViewOrderStatus=async function(id){try{const d=await api('/orders/my');const o=(d.orders||[]).find(x=>String(x.id)===String(id));if(!o)return;const st=o.status||'pending';const modal=document.createElement('div');modal.className='pz-order-status-modal-backdrop';const steps=['pending','confirmed','processing','shipped','delivered'];const idx=steps.indexOf(st);const body=st==='cancelled'?'<div class="pz-os-cancelled"><div class="pz-os-step cancelled current"><div class="dot"><i class="fas fa-circle-xmark"></i></div><span>Cancelled</span></div></div>':'<div class="pz-os-steps">'+steps.map((x,i)=>'<div class="pz-os-step '+(i<idx?'done ':'')+(i===idx?'current ':'')+'"><div class="dot"><i class="fas '+(x==='pending'?'fa-clock':x==='confirmed'?'fa-check':x==='processing'?'fa-box-open':x==='shipped'?'fa-truck':'fa-circle-check')+'"></i></div><span>'+esc(STATUS_LABELS[x])+'</span></div>').join('')+'</div>';modal.innerHTML='<div class="pz-order-status-modal"><div class="pz-os-head"><div><h3>Live Order Status</h3><div style="font-size:10px;color:var(--text-secondary);margin-top:3px">'+esc(o.id)+'</div></div><button class="pz-os-close" type="button"><i class="fas fa-times"></i></button></div><div class="pz-os-summary"><div class="pz-os-mini"><small>Status</small><strong>'+esc(STATUS_LABELS[st]||st)+'</strong></div><div class="pz-os-mini"><small>Ordered</small><strong>'+new Date(o.date||Date.now()).toLocaleDateString()+'</strong></div><div class="pz-os-mini"><small>Total</small><strong>'+money(o.total||0)+'</strong></div></div><div class="pz-os-timeline">'+body+'</div><div class="pz-os-message"><strong>'+esc(STATUS_LABELS[st]||st)+'</strong><br>'+esc(st==='pending'?'Your order has been recorded and is waiting for confirmation.':st==='confirmed'?'Your order has been confirmed.':st==='processing'?'Your order is being processed.':st==='shipped'?'Your order has been shipped.':st==='delivered'?'Your order has been delivered.':'This order has been cancelled.')+'</div></div>';modal.querySelector('.pz-os-close').onclick=()=>modal.remove();modal.addEventListener('click',e=>{if(e.target===modal)modal.remove()});document.body.appendChild(modal)}catch(_) {}}

    window.placeOrder=async function(){
      if(!window.isAuthenticated()){showMain('Sign In Required','Please sign in before ordering items.');showSignIn?.();return}
      if(!Array.isArray(cart)||!cart.length){showMain('Cart Empty','There are no items available to order right now.');return}
      const get=id=>String($(id)?.value||'').trim();const customer={name:get('checkName'),phone1:get('checkPhone1'),phone2:get('checkPhone2'),city:get('checkCity'),province:get('checkProvince'),district:get('checkDistrict'),address:get('checkAddress')};
      if(!customer.name||!customer.phone1||!customer.phone2||!customer.city||!customer.province||!customer.address){showMain('Missing Information','Please complete Checkout Details.');return}
      if(customer.phone1===customer.phone2){showMain('Contact Number Error','Contact Number 2 must be different from Contact Number 1.');return}
      try{const d=await api('/orders',{method:'POST',body:{items:cart.map(x=>({productId:x.id,quantity:Number(x.qty)||1})),customer}});const order=d.order;cart=[];updateCartCount?.();if(typeof window.__pzOriginalRenderCart==='function')window.__pzOriginalRenderCart();await refreshProducts();showMainToast('Order placed successfully!');window.open('https://wa.me/94779783990?text='+encodeURIComponent('PICKZONE NEW ORDER\nOrder ID: '+order.id+'\nCustomer: '+customer.name+'\nEmail: '+currentUser.email+'\nGrand Total: LKR '+Number(order.total||0).toFixed(2)),'_blank');if(typeof window.showOrderSuccess==='function')window.showOrderSuccess();}
      catch(e){if(e.status===409)showMain('Stock Updated','One or more products no longer have enough stock. Your cart was refreshed.');else showMain('Order Error',e.data?.message||'Unable to create order.');await loadRemoteCart();renderCart?.()}
    };

    // Preserve the existing cart renderer only as a presentation layer.
    // Wrap profile/order refresh around page navigation without changing visuals.
    const nav=window.navigateTo;
    window.navigateTo=function(page){const r=nav?.apply(this,arguments);if(page==='cart')setTimeout(()=>loadRemoteCart().then(()=>{try{window.__pzOriginalRenderCart?.()}catch(_){}}),80);if(page==='orders')setTimeout(renderRemoteOrders,80);return r};

    async function bootMain(){
      await refreshProducts(); await refreshCategories(); await loadCurrentUser();
      if(typeof window.updateAuthUI==='function')window.updateAuthUI();
      if(currentUser)await loadRemoteCart(); else cart=[];
      if(typeof window.renderFeatured==='function')window.renderFeatured();
      if(typeof window.renderHomeCategories==='function')window.renderHomeCategories();
      if(typeof window.renderCategoryFilters==='function')window.renderCategoryFilters();
      if(typeof currentPage!=='undefined'&&currentPage==='items'&&typeof window.renderItems==='function')window.renderItems('All',true);
      if(typeof currentPage!=='undefined'&&currentPage==='cart')window.__pzOriginalRenderCart?.();
      if(typeof currentPage!=='undefined'&&currentPage==='orders')renderRemoteOrders();
    }
    window.addEventListener('load',()=>setTimeout(()=>bootMain().catch(e=>console.error('[PickZoneSL] boot failed',e)),20),{once:true});
    setInterval(async()=>{try{await refreshProducts();if(currentUser){await loadRemoteCart();if(currentPage==='orders')await renderRemoteOrders();if(currentPage==='cart')window.__pzOriginalRenderCart?.()}}catch(_){}},5000);
  }
})();
