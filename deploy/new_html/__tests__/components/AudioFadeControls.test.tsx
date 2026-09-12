import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AudioFadeControls } from '../../components/audio/AudioFadeControls';

it('allows clearing and entering complete decimal seconds before committing', () => {
  const change = vi.fn();
  render(<AudioFadeControls duration={100} fadeIn={10} fadeOut={2} onChange={change} />);
  const input = screen.getByRole('spinbutton', { name: /开头渐入/ });
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.change(input, { target: { value: '6' } });
  fireEvent.change(input, { target: { value: '65.5' } });
  expect(change).not.toHaveBeenCalled();
  expect(input).toHaveValue(65.5);
  fireEvent.blur(input);
  expect(change).toHaveBeenLastCalledWith({ fadeIn: 65.5, fadeOut: 2 });
});

it('bounds fades by the available duration and accepts zero as disabled', () => {
  const change = vi.fn();
  render(<AudioFadeControls duration={5} fadeIn={2} fadeOut={1} onChange={change} />);
  const input = screen.getByRole('spinbutton', { name: /末尾渐出/ });
  fireEvent.change(input, { target: { value: '30' } }); fireEvent.blur(input);
  expect(change).toHaveBeenLastCalledWith({ fadeIn: 2, fadeOut: 3 });
  fireEvent.change(input, { target: { value: '' } }); fireEvent.blur(input);
  expect(change).toHaveBeenLastCalledWith({ fadeIn: 2, fadeOut: 0 });
});
