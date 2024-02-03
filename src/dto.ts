export class BodyDto {
  transactionHash: string;
  address: string;
  investment:number;
}

export class ParamsDto {
  address: string;
}

export class ResponseDto {
  msg: string;
  status: string;
  data:object;
}