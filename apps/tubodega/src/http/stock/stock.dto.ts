import { ApiProperty } from '@nestjs/swagger';
import { MovementView, StockPositionView } from '../movements/movements.dto.js';
import { PageView } from '../shared/shared.dto.js';

export class StockPageView {
  @ApiProperty({ type: StockPositionView, isArray: true }) data!: StockPositionView[];
  @ApiProperty({ type: PageView }) page!: PageView;
}

/** One open loan, not one balance: that is what `settlesId` exists for. */
export class OpenCustodyView {
  @ApiProperty({ type: MovementView, description: 'El préstamo' }) checkOut!: MovementView;
  @ApiProperty({ example: '3.000', description: 'La cantidad prestada menos lo ya devuelto' })
  pending!: string;
  @ApiProperty({ example: false, description: 'dueAt quedó atrás' }) overdue!: boolean;
}

export class OpenCustodyPageView {
  @ApiProperty({ type: OpenCustodyView, isArray: true }) data!: OpenCustodyView[];
  @ApiProperty({ type: PageView }) page!: PageView;
}
