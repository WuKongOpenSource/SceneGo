import React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

function AllProviders({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

function customRender(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & { route?: string }
) {
  const { route, ...renderOptions } = options || {};
  return render(ui, {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={route ? [route] : ['/']}>
        {children}
      </MemoryRouter>
    ),
    ...renderOptions,
  });
}

export * from '@testing-library/react';
export { customRender as render };
