import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';

import { Observer } from 'rxjs/Observer';
import { Observable } from 'rxjs/Observable';

import swal from 'sweetalert2';

import { Payload } from '../models/payload.model';
import { Role } from '../models/role.enum';
import { SystemMessagesService } from './system-messages.service';

@Injectable()
export class AuthService {

  /**
   * 需要权限验证的Http请求
   */
  http: HttpClient;

  /**
   * 存放Token的容器
   */
  private storage: Storage = localStorage;

  constructor(
    private httpWithoutAuth: HttpClient,
    private msg: SystemMessagesService,
    private router: Router
  ) {
    this.http = new Proxy(httpWithoutAuth, {
      get: (target: HttpClient, propKey: string) => {
        const prop: Function = target[propKey];
        return (...args: any[]): Observable<any> => {
          // 对传入的参数进行编辑
          const getArgs = (): any[] => {
            const headers = this.getAuthorizationHeader('access_token');

            // 如果最后一个参数即options被传入，则进行合并
            if (prop.length === args.length) {
              args[args.length - 1] = {headers, ...args[args.length - 1]};
            } else {
              args.push({headers});
            }
            return args;
          };

          const payload = this.getPayloadFromToken('access_token');

          // 如果过期，则刷新访问令牌
          if ((payload.exp - Math.floor(Date.now() / 1000)) < 600) {
            return Observable.create((observer: Observer<object>) => {
              this.refreshToken(() => {
                prop.apply(target, getArgs())
                  .subscribe(data => observer.next(data));
              })
            })
          }

          return prop.apply(target, getArgs());
        };
      }
    });
  }

  /**
   * 表示是否已经登录
   */
  get isLoggedIn (): boolean{
    const payload = this.getPayloadFromToken('access_token', true);
    // 游客不算登录
    return payload && payload.role >= Role.user;
  }

  /**
   * 表示是否记住登录状态
   */
  get rememberLoginState(): boolean {
    return this.storage === localStorage;
  }

  /**
   * 表示是否记住登录状态
   * @param {boolean} rememberMe 是否记住登录状态
   */
  set rememberLoginState(rememberMe: boolean) {
    // 默认是保存到localStorage里，这样的话，
    // 下次登录的时候就可以根据localStorage里的信息来判断是否进行自动登录
    this.storage = rememberMe ? localStorage : sessionStorage;
  }

  /**
   * 将访问令牌保存到客户端
   * @param {string} accessToken
   */
  saveAccessToken(accessToken: string) {
    this.storage.setItem('access_token', accessToken);
  }

  /**
   * 将更新令牌保存到客户端
   * @param {string} refreshToken
   */
  saveRefreshToken(refreshToken: string) {
    this.storage.setItem('refresh_token', refreshToken);
  }


  /**
   * 从Token中获取信息
   * @param {"access_token" | "refresh_token"} tokenName 令牌名称
   * @param {boolean} retry 是否在获取失败时再次尝试从sessionStorage中获取
   * @returns {Payload} Token信息
   */
  getPayloadFromToken(tokenName: 'access_token' | 'refresh_token', retry = false): Payload {
    let payload: Payload;
    let token = this.storage.getItem(tokenName);

    if (!token && retry) {
      // 也有可能是没选记住状态的用户在刷新页面后，
      // 没有从默认的localStorage获取到信息
      // 尝试从sessionStorage中获取
      this.rememberLoginState = false;
      token = this.storage.getItem(tokenName);
    }

    if (token) {
      payload = JSON.parse(atob(token.split('.')[1])) as Payload;
      // 用atob解码含中文的信息会导致异常，所以在后台对用户名进行了url编码
      payload.unique_name = decodeURI(payload.unique_name);
    }
    return payload;
  }

  /**
   * 刷新令牌
   * @param {Function} successCallback 刷新令牌成功时执行的回调函数
   */
  refreshToken(successCallback: Function) {
    this.httpWithoutAuth.post('api/user/refresh-token',
      null,
      {headers: this.getAuthorizationHeader('refresh_token')})
      .subscribe(res => {
        // 重新保存访问令牌
        this.saveAccessToken(res['accessToken']);

        // 执行回调函数
        successCallback();
      },  (err: HttpErrorResponse) => {
        if (err.error instanceof Error) {
          // 如果是客户端异常
          console.log('An error occurred:', err.error.message);
        } else {
          // 如果请求发生异常
          console.log(`Backend returned code ${err.status}, body was: ${err.error}`);

          if (err.status === 401) {
            // 如果token验证失效，则回到登录界面
            swal(this.msg.getMessage('E006', '账号信息'),
              this.msg.getMessage('E007', '登录'), 'error')
              .then(() => {
                // 返回登录界面
                // 清空localStorage以避免问题发生
                this.clearTokens();
                this.router.navigateByUrl('/login');
              });
          }
        }
      });
  }

  /**
   * 清除Storage中存放的所有Token信息
   */
  clearTokens () {
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('access_token');
    sessionStorage.removeItem('refresh_token');
    sessionStorage.removeItem('access_token');
  }

  /**
   * 获得带有权限验证的请求头
   * @param {"access_token" | "refresh_token"} tokenName 令牌名称
   * @returns {HttpHeaders} 带有权限验证的请求头
   */
  private getAuthorizationHeader(tokenName: 'access_token' | 'refresh_token'): HttpHeaders {
    return new HttpHeaders()
      .set('Authorization', `Bearer ${this.storage.getItem(tokenName)}`);
  }
}