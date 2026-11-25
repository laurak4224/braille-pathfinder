/* No personal plan, checklist or application dates leave this browser. */
(() => {
  'use strict';
  const section = document.createElement('section');
  section.id = 'appTools';
  section.setAttribute('aria-labelledby', 'appToolsHeading');
  section.innerHTML = `<h2 id="appToolsHeading">Save the guide offline and choose updates</h2>
    <p id="offlineStatus" role="status">Offline use needs a secure connection (HTTPS) or localhost.</p>
    <button type="button" id="installApp" hidden>Install this guide</button>
    <p>To keep the guide on your device, use your browser’s Install or Add to Home Screen option. On iPhone or iPad, you must add it to your Home Screen before enabling notifications.</p>
    <h3>Optional guide updates</h3>
    <p id="pushPrivacy">These notifications are general updates about the guide, not reminders for your application deadlines. If you enable them, this site and its push delivery provider receive your browser’s push subscription so they can send updates. Your state, checklist, and dates stay on your device. Notifications may appear on your lock screen. Turn them off here or in your browser settings.</p>
    <div class="toolbar"><button type="button" id="enablePush" aria-describedby="pushPrivacy" disabled>Enable update notifications</button>
    <button type="button" id="renewPush" disabled>Renew update notifications for 90 days</button>
    <button type="button" id="disablePush" disabled>Turn off update notifications</button></div>
    <p id="pushStatus" role="status" aria-live="polite">Checking notification support…</p>`;
  document.querySelector('main').append(section);
  const $ = id => document.getElementById(id);
  let registration;
  let installPrompt;
  let publicKey;
  let busy = false;
  const ownerKey = 'bdp-push-owner';
  const recordKey = 'bdp-push-record';
  function ownershipToken() {
    let token = localStorage.getItem(ownerKey);
    if (!token) {
      token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      localStorage.setItem(ownerKey, token);
    }
    return token;
  }
  const supported = isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const api = async (path, body) => {
    const response = await fetch('/.netlify/functions/' + path, {
      method: body ? 'POST' : 'GET', headers: body ? {'Content-Type':'application/json'} : {},
      body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('Notification service unavailable. Please try again later.');
    return response.status === 204 ? {} : response.json();
  };
  const refresh = async () => {
    const subscription = registration && await registration.pushManager.getSubscription();
    $('enablePush').disabled = busy || !supported || !publicKey || !!subscription || Notification.permission === 'denied';
    $('disablePush').disabled = busy || !subscription;
    $('renewPush').disabled = busy || !subscription || !publicKey;
    return subscription;
  };
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event; $('installApp').hidden = false;
  });
  $('installApp').addEventListener('click', async () => {
    if (!installPrompt) return;
    await installPrompt.prompt(); await installPrompt.userChoice;
    installPrompt = null; $('installApp').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('installApp').hidden = true; });
  const offlineMessage = () => {
    $('offlineStatus').textContent = navigator.serviceWorker?.controller
      ? (navigator.onLine ? 'Your offline guide is ready. You can read the saved guide without an internet connection.' : 'You are offline. You can use the saved guide, but agency websites and notifications need an internet connection.')
      : 'Saving the guide for offline use. Keep this page open until it is ready.';
  };
  window.addEventListener('online', offlineMessage); window.addEventListener('offline', offlineMessage);
  $('enablePush').addEventListener('click', async () => {
    busy = true; refresh();
    let subscription;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { $('pushStatus').textContent = 'Notifications are not enabled. You can change permission in browser settings.'; return; }
      const padding = '='.repeat((4 - publicKey.length % 4) % 4);
      const raw = atob((publicKey + padding).replace(/-/g, '+').replace(/_/g, '/'));
      const key = Uint8Array.from(raw, c => c.charCodeAt(0));
      subscription = await registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:key});
      const record = await api('push-subscriptions', {action:'register', subscription:subscription.toJSON(), removalToken:ownershipToken()});
      localStorage.setItem(recordKey, JSON.stringify(record));
      $('pushStatus').textContent = 'Update notifications enabled. No personal plan details were sent.';
    } catch (error) {
      if (subscription) await subscription.unsubscribe().catch(() => {});
      $('pushStatus').textContent = 'Notifications could not be enabled. Check your internet connection and try again. If this continues, the site may not be set up to send updates.';
    } finally { busy = false; await refresh(); }
  });
  $('renewPush').addEventListener('click', async () => {
    busy = true; refresh();
    try {
      const subscription = await registration.pushManager.getSubscription();
      const record = await api('push-subscriptions', {action:'register', subscription:subscription.toJSON(), removalToken:ownershipToken()});
      localStorage.setItem(recordKey, JSON.stringify(record));
      $('pushStatus').textContent = 'Update notifications renewed for up to 90 days.';
    } catch { $('pushStatus').textContent = 'Notifications could not be renewed. Check your connection and try again. If you cleared this site’s saved browser data, turn notifications off here, then enable them again.'; }
    finally { busy = false; await refresh(); }
  });
  $('disablePush').addEventListener('click', async () => {
    busy = true; refresh();
    try {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        // Remove persistent record before dropping the local capability needed to authenticate removal.
        const record = JSON.parse(localStorage.getItem(recordKey) || 'null');
        if (!record?.id) throw new Error('Missing subscription ownership record');
        await api('push-subscriptions', {action:'remove', id:record.id, removalToken:ownershipToken()});
        if (!await subscription.unsubscribe()) throw new Error('unsubscribe failed');
      }
      localStorage.removeItem(recordKey);
      $('pushStatus').textContent = 'Update notifications turned off and server subscription removed.';
    } catch {
      const subscription = await registration.pushManager.getSubscription().catch(() => null);
      if (subscription) await subscription.unsubscribe().catch(() => {});
      $('pushStatus').textContent = 'We tried to turn off notifications in this browser, but could not confirm removal from the server. A subscription record may remain until it expires. Block this site’s notifications in browser settings to make sure delivery stops.';
    } finally { busy = false; await refresh(); }
  });
  (async () => {
    if (!isSecureContext || !('serviceWorker' in navigator)) {
      $('pushStatus').textContent = 'Offline use and notifications need a secure connection (HTTPS) and a browser that supports service workers. You can still read the online guide.'; return;
    }
    try {
      registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      navigator.serviceWorker.addEventListener('controllerchange', offlineMessage);
      offlineMessage();
      if (!supported) { $('pushStatus').textContent = 'This browser does not support push notifications here. You can still use the guide.'; return; }
      const subscription = await refresh();
      if (subscription) $('pushStatus').textContent = 'This browser has update notifications enabled.';
      try {
        const config = await api('push-config');
        publicKey = config.publicKey;
        if (typeof publicKey !== 'string' || !publicKey) throw new Error('not configured');
        if (!subscription) $('pushStatus').textContent = Notification.permission === 'denied'
          ? 'Notifications are blocked in browser settings. The guide still works normally.'
          : 'Notifications are off. Enable them only if you want general guide updates.';
      } catch {
        if (!subscription) $('pushStatus').textContent = 'This site is not set up to send notifications. You can still use the offline guide.';
      }
      await refresh();
    } catch { $('offlineStatus').textContent = 'The guide could not be saved for offline use. You can still use it online. Reload the page to try again.'; $('pushStatus').textContent = 'Notifications are unavailable until the offline setup is complete.'; }
  })();
})();
