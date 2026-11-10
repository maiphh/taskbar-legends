import './style.css';
import { invoke } from '@tauri-apps/api/core';

document.getElementById('open-management')?.addEventListener('click', () => { void invoke('open_management'); });
document.getElementById('toggle-edit')?.addEventListener('click', () => { void invoke('request_compact_edit'); });
