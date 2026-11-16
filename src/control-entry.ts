import './style.css';
import { invoke } from '@tauri-apps/api/core';
import { loadFonts } from './font';

void loadFonts().catch(error => { document.body.dataset.fontError = String(error); });

document.getElementById('open-management')?.addEventListener('click', () => { void invoke('open_management'); });
document.getElementById('toggle-edit')?.addEventListener('click', () => { void invoke('request_compact_edit'); });
