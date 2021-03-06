﻿using System.Security.Claims;
using System.Threading.Tasks;

namespace StravaSegmentHunter.OAuth.AccessTokenManagement
{
    /// <summary>
    /// Storage abstraction for access and refresh tokens
    /// </summary>
    public interface IUserTokenStore
    {
        /// <summary>
        /// Stores tokens
        /// </summary>
        /// <param name="user">User the tokens belong to</param>
        /// <param name="accessToken">The access token</param>
        /// <param name="expiresIn">The access token lifetime in seconds</param>
        /// <param name="refreshToken">The refresh token</param>
        /// <returns></returns>
        Task StoreTokenAsync(ClaimsPrincipal user, string accessToken, int expiresIn, string refreshToken);

        /// <summary>
        /// Retrieves tokens from store
        /// </summary>
        /// <param name="user">User the tokens belong to</param>
        /// <returns>access and refresh token and access token expiration</returns>
        Task<UserAccessToken> GetTokenAsync(ClaimsPrincipal user);

        /// <summary>
        /// Clears the stored tokens for a given user
        /// </summary>
        /// <param name="user">User the tokens belong to</param>
        /// <returns></returns>
        Task ClearTokenAsync(ClaimsPrincipal user);
    }
}