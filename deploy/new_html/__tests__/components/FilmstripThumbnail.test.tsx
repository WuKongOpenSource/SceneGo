import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FilmstripThumbnail } from '../../components/FilmstripThumbnail';

describe('FilmstripThumbnail', () => {
  it('shows the generated video frame with perforated film bars', () => {
    render(
      <FilmstripThumbnail
        src="/api/thumbnail?url=%2Fstorage%2Fvideo.mp4&width=640&height=360"
        alt="视频缩略图"
      />,
    );

    expect(screen.getByRole('img', { name: '视频缩略图' })).toHaveAttribute(
      'src',
      '/api/thumbnail?url=%2Fstorage%2Fvideo.mp4&width=640&height=360',
    );
    expect(screen.getByTestId('filmstrip-sprockets-top')).toBeInTheDocument();
    expect(screen.getByTestId('filmstrip-sprockets-bottom')).toBeInTheDocument();
  });

  it('uses a clear fallback only when the thumbnail cannot be loaded', () => {
    render(<FilmstripThumbnail src="/broken-thumbnail" alt="视频缩略图" />);

    fireEvent.error(screen.getByRole('img', { name: '视频缩略图' }));

    expect(screen.getByText('视频缩略图暂不可用')).toBeInTheDocument();
    expect(screen.queryByTestId('filmstrip-sprockets-top')).not.toBeInTheDocument();
  });
});
