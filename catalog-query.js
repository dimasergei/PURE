(() => {
  'use strict';
  const main = document.getElementById('pure-query-main');
  if (!main) return;

  // Each preview opens the original URL supplied by the server-rendered row.
  // A plain link to every sheet remains available alongside the preview.
  main.addEventListener('click', event => {
    const button = event.target.closest('[data-preview-report]');
    if (!button) return;
    const links = [...button.closest('td').querySelectorAll('a[href]')];
    if (!links.length) return;
    const dialog = document.createElement('dialog');
    if (typeof dialog.showModal !== 'function') {
      location.assign(links[0].href);
      return;
    }
    dialog.className = 'ap-coa-dialog';
    dialog.setAttribute('aria-labelledby', 'query-document-title');
    const bar = document.createElement('div');
    bar.className = 'ap-coa-viewer-bar';
    const heading = document.createElement('h2');
    heading.id = 'query-document-title';
    heading.textContent = 'Report for ' + button.closest('tr').querySelector('th').innerText.replace(/\s+/g, ' ');
    const close = document.createElement('button');
    close.className = 'ap-button ap-button-small';
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => dialog.close());
    bar.append(heading, close);
    dialog.append(bar);
    const fallback = links[0].cloneNode(true);
    fallback.className = 'ap-coa-viewer-context';
    dialog.append(fallback);
    if (links[0].textContent.startsWith('Report sheet')) {
      const pages = document.createElement('div');
      pages.className = 'ap-coa-image-pages';
      for (const [i, link] of links.entries()) {
        const image = document.createElement('img');
        image.src = link.href;
        image.alt = heading.textContent + ', sheet ' + (i + 1);
        image.referrerPolicy = 'no-referrer';
        pages.append(image);
      }
      dialog.append(pages);
    } else {
      const viewer = document.createElement('iframe');
      viewer.src = links[0].href;
      viewer.title = heading.textContent;
      viewer.referrerPolicy = 'no-referrer';
      dialog.append(viewer);
    }
    dialog.addEventListener('close', () => {
      dialog.remove();
      button.focus();
    }, {once:true});
    document.body.append(dialog);
    dialog.showModal();
    close.focus();
  });
})();
