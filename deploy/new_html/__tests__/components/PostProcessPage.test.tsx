import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

import PostProcessPage from '../../components/PostProcessPage';

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ projectId: 'project_1', project: { projectName: '测试项目' } }),
}));

describe('PostProcessPage', () => {
  it('uses the shared wide page container', () => {
    render(
      <MemoryRouter>
        <PostProcessPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('post-process-content')).toHaveClass('max-w-[1680px]');
  });
});
