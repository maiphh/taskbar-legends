const url = new URL(location.href);
url.searchParams.set('combat', 'party-v2');
url.searchParams.set('compact', '1');
history.replaceState(null, '', url);
await import('./main');
export {};
