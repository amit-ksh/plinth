// Carries the Shopify result from the Worker's callback page into the app, then opens Import.
// The data stays in this tab's session storage until the Import screen reads and removes it.
(function () {
  var status = document.getElementById('status');
  try {
    var text = document.getElementById('shopify-result').textContent;
    sessionStorage.setItem('plinth-shopify', text);
    location.replace('/app/#import');
  } catch (error) {
    if (status) status.textContent = 'This browser blocked the hand-off to Plinth. Allow site data for this page, then connect again.';
  }
})();
