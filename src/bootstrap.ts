const params = new URLSearchParams(location.search);
if (params.get('view') === 'management') await import('./management-entry');
else if (params.get('view') === 'control') await import('./control-entry');
else await import('./main');
export {};
