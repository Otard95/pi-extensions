export interface ResultMatchPattern<T, E, M> {
	readonly ok: (value: T) => M;
	readonly err: (error: E) => M;
}
export interface IResult<T, E> {
	isOk(): boolean;
	isErr(): boolean;
	/**
	 * @throws ReferenceError
	 */
	unwrap(): T | never;
	unwrapOr(defaultValue: T): T;
	/**
	 * @throws ReferenceError
	 */
	unwrapErr(): E | never;
	match<M>(pattern: ResultMatchPattern<T, E, M>): M;
	map<M>(fn: (value: T) => M): IResult<M, E>;
	mapErr<M>(fn: (err: E) => M): IResult<T, M>;
}

export abstract class Result<T, E> implements IResult<T, E> {
	public static Ok<T>(value: T): Result<T, never> {
		return new OkResult(value);
	}
	public static Err<E>(error: E): Result<never, E> {
		return new ErrResult(error);
	}

	public static fromPromise<T, E>(p: Promise<T>): Promise<Result<T, E>> {
		return p.then(Result.Ok, Result.Err);
	}

	public static try<T>(f: () => T): Result<T, Error> {
		try {
			return Result.Ok(f());
		} catch (err) {
			if (err instanceof Error) {
				return Result.Err(err);
			}
			return Result.Err(new Error(`${err}`));
		}
	}

	abstract isOk(): this is OkResult<T, E>;
	abstract isErr(): this is ErrResult<T, E>;
	abstract unwrap(): T | never;
	abstract unwrapOr(defaultValue: T): T;
	abstract unwrapErr(): E | never;
	abstract match<M>(pattern: ResultMatchPattern<T, E, M>): M;
	abstract map<M>(fn: (value: T) => M): IResult<M, E>;
	abstract mapErr<M>(fn: (err: E) => M): IResult<T, M>;
}

export class OkResult<T, E> extends Result<T, E> {
	public constructor(private readonly value: T) {
		super();
	}

	isOk(): this is OkResult<T, E> {
		return true;
	}
	isErr(): this is ErrResult<T, E> {
		return false;
	}
	unwrap(): T | never {
		return this.value;
	}
	unwrapOr(_: T): T {
		return this.value;
	}
	unwrapErr(): E | never {
		throw new ReferenceError("Cannot unwrap a success as a failure");
	}

	match<M>(pattern: ResultMatchPattern<T, E, M>): M {
		return pattern.ok(this.value);
	}
	map<M>(fn: (value: T) => M): IResult<M, E> {
		return Result.Ok(fn(this.value));
	}
	mapErr<M>(_: (err: E) => M): IResult<T, M> {
		return Result.Ok(this.value);
	}
}

export class ErrResult<T, E> extends Result<T, E> {
	public constructor(private readonly error: E) {
		super();
	}

	isOk(): this is OkResult<T, E> {
		return false;
	}
	isErr(): this is ErrResult<T, E> {
		return true;
	}
	unwrap(): T | never {
		throw new Error("Cannot unwrap a failure");
	}
	unwrapOr(defaultValue: T): T {
		return defaultValue;
	}
	unwrapErr(): E | never {
		return this.error;
	}

	match<M>(pattern: ResultMatchPattern<T, E, M>): M {
		return pattern.err(this.error);
	}
	map<M>(_: (value: T) => M): IResult<M, E> {
		return Result.Err(this.error);
	}
	mapErr<M>(fn: (err: E) => M): IResult<T, M> {
		return Result.Err(fn(this.error));
	}
}
