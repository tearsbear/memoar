'use client';
import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useLibrary } from './library-provider';

export function LibraryConnection() {
  const library = useLibrary(); const [id, setId] = useState('');
  return <div className="connection-panel">
    <p className="status-label">{library.connected ? 'Extension connected' : 'Connect your browser'}</p>
    <h2>{library.connected ? 'Your library, within reach.' : 'Bring your saves into Memoar.'}</h2>
    <p>Open Memoar from the extension’s <strong>Your library</strong> button in the same Chrome profile. You can also enter its ID from Chrome’s extension settings.</p>
    <form onSubmit={event => { event.preventDefault(); if (id.trim() === library.extensionId) void library.refresh(); else library.connect(id.trim()); }}>
      <TextInput label="Memoar extension ID" value={id} onChange={setId} placeholder="32-character extension ID" />
      <Button label="Check connection" type="submit" isLoading={library.busy} />
    </form>
    {library.error && <p role="alert" className="memoar-error">{library.error}</p>}
    {library.busy && <p role="status">{library.progress}</p>}
    <a href="/getting-started#install">View the install guide</a>
  </div>;
}
